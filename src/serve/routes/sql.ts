import { BusyError, type ExecResult } from "../../store.ts";
import { HttpError } from "../http.ts";
import { createdTable, isRead, statementCount, touchesInternal } from "../sqltext.ts";
import { toWire } from "../wire.ts";
import { objectBody, writeTx } from "../write.ts";
import type { Routes } from "./index.ts";

const MAX_ROWS = 1000;

export const sqlRoutes: Routes = (router, ctx) => {
  router.add("POST", "/api/sql", ({ body }) => {
    const sql = objectBody(body, "body").sql;
    if (typeof sql !== "string" || sql.trim() === "") throw new HttpError(400, "sql is required");
    if (statementCount(sql) > 1) throw new HttpError(400, "run one statement at a time");
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
