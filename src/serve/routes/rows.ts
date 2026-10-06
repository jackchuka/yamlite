import { existsSync, readFileSync } from "node:fs";
import { isAbsolute, join, relative } from "node:path";
import { encode, recordToRow } from "../../codec.ts";
import { canonical } from "../../hash.ts";
import { invalidKey } from "../../source/files.ts";
import { markdownExt } from "../../source/markdown.ts";
import { q } from "../../store.ts";
import { type DbRow, own, type TableSpec } from "../../types.ts";
import { type ApiContext, displayPath, findView, tableSpec, type ViewTarget } from "../context.ts";
import { HttpError, Reply } from "../http.ts";
import { buildWhere, orderBy, parseRowQuery, type RowQuery } from "../query.ts";
import { fromWire, toWire } from "../wire.ts";
import { ensureColumns, fromWireRecord, objectBody, writeTx } from "../write.ts";
import type { Routes } from "./index.ts";

export function recordFile(spec: TableSpec, key: string): string {
  if (spec.mode === "list") return spec.path;
  const exts = spec.codec === "markdown" ? [markdownExt(spec.glob) ?? ".md"] : [".yaml", ".yml"];
  for (const ext of exts) {
    const path = join(spec.path, `${key}${ext}`);
    if (existsSync(path)) return path;
  }
  return join(spec.path, `${key}${exts[0]}`);
}

// a key is never a path, but a record file must stay inside its table directory regardless
export function insideTable(spec: TableSpec, file: string): boolean {
  if (spec.mode === "list") return true;
  const rel = relative(spec.path, file);
  return rel !== "" && !rel.startsWith("..") && !isAbsolute(rel);
}

function checkKey(spec: TableSpec, key: unknown): string {
  if (typeof key !== "string" || key === "") throw new HttpError(400, "key is required", { field: "key" });
  if (spec.mode === "files") {
    const reason = invalidKey(key);
    if (reason) throw new HttpError(400, reason, { field: "key" });
  }
  return key;
}

function noKeyIn(spec: TableSpec, values: Record<string, unknown>, hint: string): void {
  if (spec.key in values) throw new HttpError(400, `"${spec.key}" is the key; ${hint}`, { field: spec.key });
}

function viewRows(ctx: ApiContext, view: ViewTarget, rq: RowQuery) {
  if (!view.record) return { rows: [], total: 0 };
  const { identity } = view.record;
  const types = new Map(Object.entries(view.record.columns));
  // prefix searches the table's key, the first identity column
  const { where, params: values } = buildWhere(rq, types, identity[0] as string);
  const total = Number(ctx.store.query(`SELECT count(*) AS n FROM ${q(view.name)} ${where}`, ...values)[0]?.n ?? 0);
  const found = ctx.store.query(
    `SELECT * FROM ${q(view.name)} ${where} ${orderBy(rq, types, identity)} LIMIT ? OFFSET ?`,
    ...values,
    rq.limit,
    rq.offset,
  );
  return { rows: found.map((r) => toWire(r, types)), total };
}

export const rowRoutes: Routes = (router, ctx) => {
  router.add("GET", "/api/tables/:table/rows", ({ params, query }) => {
    const view = findView(ctx, params.table as string);
    if (view) return viewRows(ctx, view, parseRowQuery(query));
    const spec = tableSpec(ctx, params.table as string);
    if (!ctx.store.tableExists(spec.name)) return { rows: [], total: 0 };
    const types = ctx.store.columns(spec.name);
    const rq = parseRowQuery(query);
    const { where, params: values } = buildWhere(rq, types, spec.key);
    const total = Number(ctx.store.query(`SELECT count(*) AS n FROM ${q(spec.name)} ${where}`, ...values)[0]?.n ?? 0);
    const found = ctx.store.query(
      `SELECT * FROM ${q(spec.name)} ${where} ${orderBy(rq, types, [spec.key])} LIMIT ? OFFSET ?`,
      ...values,
      rq.limit,
      rq.offset,
    );
    return { rows: found.map((r) => toWire(r, types)), total };
  });

  router.add("GET", "/api/tables/:table/rows/:key", ({ params }) => {
    const spec = tableSpec(ctx, params.table as string);
    const key = params.key as string;
    const row = ctx.store.tableExists(spec.name) ? ctx.store.readRow(spec.name, spec.key, key) : undefined;
    if (!row) throw new HttpError(404, `no record "${key}" in ${spec.name}`);
    const file = recordFile(spec, key);
    return {
      row: toWire(row, ctx.store.columns(spec.name)),
      file: displayPath(ctx.root, file),
      yaml: insideTable(spec, file) && existsSync(file) ? readFileSync(file, "utf8") : null,
    };
  });

  router.add("POST", "/api/tables/:table/rows", ({ params, body }) => {
    const spec = tableSpec(ctx, params.table as string);
    const b = objectBody(body, "body");
    const key = checkKey(spec, b.key);
    const values = objectBody(b.values, "values");
    noKeyIn(spec, values, 'send it as "key"');
    const { store } = ctx;
    writeTx(store, () => {
      const before = store.tableExists(spec.name) ? store.columns(spec.name) : new Map();
      const record = fromWireRecord(values, before);
      const types = ensureColumns(store, spec, record);
      const keyValue = encode(fromWire(key, types.get(spec.key)));
      if (store.readRow(spec.name, spec.key, keyValue)) {
        throw new HttpError(409, `"${key}" already exists in ${spec.name}`, { field: "key" });
      }
      const row: DbRow = { ...recordToRow(record), [spec.key]: keyValue };
      store.upsert(spec.name, spec.key, row, Object.keys(row));
    });
    return new Reply(201, { key });
  });

  router.add("PATCH", "/api/tables/:table/rows/:key", ({ params, body }) => {
    const spec = tableSpec(ctx, params.table as string);
    const key = params.key as string;
    const b = objectBody(body, "body");
    const values = objectBody(b.values, "values");
    const base = objectBody(b.base, "base");
    noKeyIn(spec, values, "rename the record instead");
    const { store } = ctx;
    writeTx(store, () => {
      const row = store.tableExists(spec.name) ? store.readRow(spec.name, spec.key, key) : undefined;
      if (!row) throw new HttpError(404, `no record "${key}" in ${spec.name}`);
      const types = store.columns(spec.name);
      const current = toWire(row, types);
      // only the fields being saved must be unchanged; edits to other fields are kept
      const stale = Object.keys(values).filter(
        (f) => canonical(own(current, f) ?? null) !== canonical(own(base, f) ?? null),
      );
      if (stale.length > 0) {
        throw new HttpError(409, `changed since it was loaded: ${stale.join(", ")}`, { current, stale });
      }
      const record = fromWireRecord(values, types);
      ensureColumns(store, spec, record);
      const update: DbRow = { ...recordToRow(record), [spec.key]: row[spec.key] ?? null };
      store.upsert(spec.name, spec.key, update, Object.keys(update));
    });
    return { ok: true };
  });

  router.add("POST", "/api/tables/:table/rows/:key/rename", ({ params, body }) => {
    const spec = tableSpec(ctx, params.table as string);
    const from = params.key as string;
    const to = checkKey(spec, objectBody(body, "body").to);
    if (to === from) return { key: to };
    const { store } = ctx;
    writeTx(store, () => {
      const row = store.tableExists(spec.name) ? store.readRow(spec.name, spec.key, from) : undefined;
      if (!row) throw new HttpError(404, `no record "${from}" in ${spec.name}`);
      const toValue = encode(fromWire(to, store.columns(spec.name).get(spec.key)));
      if (store.readRow(spec.name, spec.key, toValue)) {
        throw new HttpError(409, `"${to}" already exists in ${spec.name}`, { field: "key" });
      }
      store.run(
        `UPDATE ${q(spec.name)} SET ${q(spec.key)} = ? WHERE ${q(spec.key)} = ?`,
        toValue,
        row[spec.key] ?? null,
      );
    });
    return { key: to };
  });

  router.add("DELETE", "/api/tables/:table/rows/:key", ({ params }) => {
    const spec = tableSpec(ctx, params.table as string);
    const key = params.key as string;
    const { store } = ctx;
    writeTx(store, () => {
      const row = store.tableExists(spec.name) ? store.readRow(spec.name, spec.key, key) : undefined;
      if (!row) throw new HttpError(404, `no record "${key}" in ${spec.name}`);
      store.delete(spec.name, spec.key, row[spec.key] ?? null);
    });
    return { ok: true };
  });
};
