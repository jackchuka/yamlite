import type { BindParams, Database, SqlValue } from "sql.js";
import { q } from "../../../../src/ident.ts";
import { HttpError } from "../../../../src/serve/errors.ts";
import { buildWhere, orderBy, parseRowQuery } from "../../../../src/serve/query.ts";
import { isPageStatement, isRead, statementCount } from "../../../../src/serve/sqltext.ts";
import { toWire } from "../../../../src/serve/wire.ts";
import type { ColumnType, DbRow, DbValue } from "../../../../src/types.ts";
import { type Api, ApiError, rowsQuery } from "../api";
import type { ConflictDetail, RecordDetail, RowsPage, Snapshot, SqlResult, TableSchema, YamlMap } from "../types";

export const READ_ONLY_MESSAGE = "read-only snapshot: only SELECT, EXPLAIN and VALUES run here";
const MAX_ROWS = 1000;

const refuse = (): Promise<never> => Promise.reject(new ApiError(403, READ_ONLY_MESSAGE, { error: READ_ONLY_MESSAGE }));

// sql.js binds bigint as a double: safe integers go as numbers, which compare like the server's native integers
// on columns without affinity; unsafe ones go as text so INTEGER columns still compare them exactly
const bindValue = (v: DbValue): SqlValue => {
  if (typeof v !== "bigint") return v as SqlValue;
  return v >= BigInt(Number.MIN_SAFE_INTEGER) && v <= BigInt(Number.MAX_SAFE_INTEGER) ? Number(v) : v.toString();
};

function toApiError(e: unknown): ApiError {
  if (e instanceof ApiError) return e;
  if (e instanceof HttpError) return new ApiError(e.status, e.message, { error: e.message, ...e.extra });
  const message = e instanceof Error ? e.message : String(e);
  return new ApiError(400, message, { error: message });
}

async function guard<T>(fn: () => T | Promise<T>): Promise<T> {
  try {
    return await fn();
  } catch (e) {
    throw toApiError(e);
  }
}

export function createStaticApi(opts: {
  db: Database;
  snapshot: Snapshot;
  loadYaml: (table: string) => Promise<YamlMap>;
  loadPage: (name: string) => Promise<string>;
}): Api {
  const { db, snapshot } = opts;
  const { meta } = snapshot;

  function all(sql: string, params: DbValue[] = [], limit = Number.POSITIVE_INFINITY) {
    const stmt = db.prepare(sql);
    try {
      stmt.bind(params.map(bindValue) as BindParams);
      const rows: DbRow[] = [];
      let truncated = false;
      while (stmt.step()) {
        if (rows.length === limit) {
          truncated = true;
          break;
        }
        rows.push(
          (
            stmt as unknown as { getAsObject(p: null, c: { useBigInt: boolean }): Record<string, SqlValue | bigint> }
          ).getAsObject(null, { useBigInt: true }) as unknown as DbRow,
        );
      }
      return { columns: stmt.getColumnNames(), rows, truncated };
    } finally {
      stmt.free();
    }
  }

  function select(sql: string): SqlResult {
    const started = performance.now();
    const r = all(sql, [], MAX_ROWS);
    const ms = Math.round((performance.now() - started) * 10) / 10;
    return { columns: r.columns, rows: r.rows.map((row) => toWire(row, new Map())), truncated: r.truncated, ms };
  }

  function page(
    name: string,
    types: Map<string, ColumnType>,
    keyCols: string[],
    prefixCol: string,
    qs: URLSearchParams,
  ): RowsPage {
    const rq = parseRowQuery(qs);
    const { where, params } = buildWhere(rq, types, prefixCol);
    const total = Number(all(`SELECT count(*) AS n FROM ${q(name)} ${where}`, params).rows[0]?.n ?? 0);
    const found = all(`SELECT * FROM ${q(name)} ${where} ${orderBy(rq, types, keyCols)} LIMIT ? OFFSET ?`, [
      ...params,
      rq.limit,
      rq.offset,
    ]).rows;
    return { rows: found.map((r) => toWire(r, types)), total };
  }

  const tableOf = (name: string) => {
    const t = meta.tables.find((x) => x.name === name);
    if (!t) throw new HttpError(404, `unknown table: ${name}`);
    return t;
  };

  return {
    meta: async () => meta,
    rows: (table, p) =>
      guard(() => {
        const view = meta.views.find((v) => v.name === table);
        if (view) {
          if (!view.inDb) return { rows: [], total: 0 };
          return page(
            view.name,
            new Map(Object.entries(view.columns)),
            view.identity,
            view.identity[0] as string,
            rowsQuery(p),
          );
        }
        const t = tableOf(table);
        if (!t.inDb) return { rows: [], total: 0 };
        return page(t.name, new Map(Object.entries(t.columns)), [t.key], t.key, rowsQuery(p));
      }),
    schema: (table) =>
      guard(() => {
        const s = snapshot.schemas[table];
        if (!s) throw new HttpError(404, `unknown table: ${table}`);
        return s as TableSchema;
      }),
    record: (table, key) =>
      guard(async (): Promise<RecordDetail> => {
        const t = tableOf(table);
        const row = t.inDb ? all(`SELECT * FROM ${q(t.name)} WHERE ${q(t.key)} = ?`, [key]).rows[0] : undefined;
        if (!row) throw new HttpError(404, `no record "${key}" in ${t.name}`);
        const out = { row: toWire(row, new Map(Object.entries(t.columns))), file: "", yaml: null as string | null };
        try {
          const { files, keys } = await opts.loadYaml(t.name);
          const file = Object.hasOwn(keys, key) ? keys[key] : undefined;
          if (file === undefined) return out;
          return { ...out, file, yaml: Object.hasOwn(files, file) ? (files[file] as string) : null };
        } catch (e) {
          return { ...out, yamlError: e instanceof Error ? e.message : String(e) };
        }
      }),
    sql: (sql) =>
      guard((): SqlResult => {
        if (sql.trim() === "") throw new HttpError(400, "sql is required");
        if (statementCount(sql) > 1) throw new HttpError(400, "run one statement at a time");
        if (!isRead(sql)) throw new ApiError(403, READ_ONLY_MESSAGE, { error: READ_ONLY_MESSAGE });
        return select(sql);
      }),
    pageHtml: (name) => guard(() => opts.loadPage(name)),
    pageSql: (name, sql) =>
      guard((): SqlResult => {
        const spec = meta.pages.find((p) => p.name === name);
        if (!spec) throw new HttpError(404, `unknown page: ${name}`);
        if (!spec.sql) throw new HttpError(403, `page ${name} may not run SQL`);
        if (sql.trim() === "") throw new HttpError(400, "sql is required");
        if (statementCount(sql) > 1) throw new HttpError(400, "run one statement at a time");
        if (!isPageStatement(sql)) throw new HttpError(403, "a page can only run SELECT");
        return select(sql);
      }),
    conflicts: async () => ({ conflicts: [] }),
    conflict: () => Promise.reject(new ApiError(404, "no conflicts in a snapshot", {})) as Promise<ConflictDetail>,
    create: refuse,
    update: refuse,
    rename: refuse,
    remove: refuse,
    createTable: refuse,
    restore: refuse,
    dismiss: refuse,
  };
}
