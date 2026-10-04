import { BusyError, type ExecResult } from "../../store.ts";
import { declaredViews } from "../../views.ts";
import type { ApiContext } from "../context.ts";
import { HttpError } from "../http.ts";
import { createdTable, firstKeyword, isRead, statementCount, touchesInternal } from "../sqltext.ts";
import { toWire } from "../wire.ts";
import { objectBody, writeTx } from "../write.ts";
import type { Routes } from "./index.ts";
import { pageSpec } from "./pages.ts";

const MAX_ROWS = 1000;

const elapsed = (started: number) => Math.round((performance.now() - started) * 10) / 10;

function pageQuery(ctx: ApiContext, name: unknown, sql: string) {
  if (typeof name !== "string") throw new HttpError(400, "page must be a page name");
  const page = pageSpec(ctx, name);
  if (!page.sql) throw new HttpError(403, `page ${name} may not run SQL`);
  // WITH may lead an update; the read-only connection and its authorizer are what refuse that
  if (!isRead(sql) && firstKeyword(sql) !== "WITH") throw new HttpError(403, "a page can only run SELECT");
  const views = ctx.y.tables.flatMap((t) => declaredViews(t).map(({ spec, parent }) => ({ name: spec.name, parent })));
  const started = performance.now();
  const r = ctx.pageSql.run(page, views, sql, MAX_ROWS);
  return {
    columns: r.columns,
    rows: r.rows.map((row) => toWire(row, new Map())),
    truncated: r.truncated,
    ms: elapsed(started),
  };
}

export const sqlRoutes: Routes = (router, ctx) => {
  router.add("POST", "/api/sql", ({ body }) => {
    const b = objectBody(body, "body");
    const sql = b.sql;
    if (typeof sql !== "string" || sql.trim() === "") throw new HttpError(400, "sql is required");
    if (statementCount(sql) > 1) throw new HttpError(400, "run one statement at a time");
    if (b.page !== undefined) return pageQuery(ctx, b.page, sql);
    const read = isRead(sql);
    if (!read && touchesInternal(sql)) {
      throw new HttpError(
        400,
        "_yamlite_state, _yamlite_columns and _yamlite_views are yamlite's bookkeeping; writing them breaks sync",
      );
    }
    const started = performance.now();
    let result: ExecResult;
    try {
      result = read ? ctx.store.execute(sql, MAX_ROWS) : writeTx(ctx.store, () => ctx.store.execute(sql, MAX_ROWS));
    } catch (e) {
      if (e instanceof BusyError || e instanceof HttpError) throw e;
      throw new HttpError(400, e instanceof Error ? e.message : String(e));
    }
    const ms = Math.round((performance.now() - started) * 10) / 10;
    if (result.columns) {
      return {
        columns: result.columns,
        rows: result.rows.map((r) => toWire(r, new Map())),
        truncated: result.truncated,
        ms,
      };
    }
    const created = createdTable(sql);
    const unmanaged =
      created !== null && ctx.store.tableExists(created) && !ctx.y.tables.some((t) => t.name === created)
        ? created
        : undefined;
    return { changes: result.changes, ms, ...(unmanaged ? { unmanaged } : {}) };
  });
};
