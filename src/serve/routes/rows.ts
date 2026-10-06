import { existsSync, readFileSync } from "node:fs";
import { isAbsolute, join, relative } from "node:path";
import { encode } from "../../codec.ts";
import { canonical } from "../../hash.ts";
import { markdownExt } from "../../source/markdown.ts";
import { q } from "../../store.ts";
import { own, type TableSpec } from "../../types.ts";
import { type ApiContext, displayPath, findView, tableSpec, type ViewTarget } from "../context.ts";
import { HttpError, Reply } from "../http.ts";
import { buildWhere, orderBy, parseRowQuery, type RowQuery } from "../query.ts";
import { checkKey, deleteRecord, insertRecord, noKeyIn, readRecord, updateRecord } from "../records.ts";
import { fromWire, toWire } from "../wire.ts";
import { objectBody, writeTx } from "../write.ts";
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

function viewRows(ctx: ApiContext, view: ViewTarget, rq: RowQuery) {
  if (!view.record) return { rows: [], total: 0 };
  const { identity } = view.record;
  const types = new Map(Object.entries(view.record.columns));
  const { where, params: values } = buildWhere(rq, types);
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
    const { where, params: values } = buildWhere(rq, types);
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
    writeTx(ctx.store, () => insertRecord(ctx.store, spec, key, values));
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
      const current = readRecord(store, spec, key);
      if (!current) throw new HttpError(404, `no record "${key}" in ${spec.name}`);
      // only the fields being saved must be unchanged; edits to other fields are kept
      const stale = Object.keys(values).filter(
        (f) => canonical(own(current, f) ?? null) !== canonical(own(base, f) ?? null),
      );
      if (stale.length > 0) {
        throw new HttpError(409, `changed since it was loaded: ${stale.join(", ")}`, { current, stale });
      }
      updateRecord(store, spec, key, values);
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
    writeTx(ctx.store, () => deleteRecord(ctx.store, spec, params.key as string));
    return { ok: true };
  });
};
