import { existsSync } from "node:fs";
import { join } from "node:path";
import { registerInConfig } from "../../configfile.ts";
import { COLUMN_TYPES, type ColumnType, own } from "../../types.ts";
import { findView } from "../context.ts";
import { HttpError, Reply } from "../http.ts";
import { objectBody, writeTx } from "../write.ts";
import type { Routes } from "./index.ts";

const NAME = /^[A-Za-z_][A-Za-z0-9_-]*$/;

export const tableRoutes: Routes = (router, ctx) => {
  router.add("POST", "/api/tables", ({ body }) => {
    const b = objectBody(body, "body");
    const name = b.name;
    if (typeof name !== "string" || !NAME.test(name) || name.startsWith("_yamlite")) {
      throw new HttpError(400, "a table name uses letters, digits, _ and -, and starts with a letter or _", {
        field: "name",
      });
    }
    const mode = b.mode ?? "files";
    if (mode !== "files" && mode !== "list") throw new HttpError(400, 'mode is "files" or "list"', { field: "mode" });
    const key = b.key ?? "id";
    if (typeof key !== "string" || key === "") throw new HttpError(400, "key must be a column name", { field: "key" });
    const columns = objectBody(b.columns, "columns") as Record<string, ColumnType>;
    for (const [column, type] of Object.entries(columns)) {
      if (!COLUMN_TYPES.includes(type)) {
        throw new HttpError(400, `${column}: type must be one of ${COLUMN_TYPES.join(", ")}`, { field: "columns" });
      }
    }
    const onDisk = [name, `${name}.yaml`, `${name}.yml`].some((entry) => existsSync(join(ctx.root, entry)));
    if (ctx.y.tables.some((t) => t.name === name) || onDisk) {
      throw new HttpError(409, `a table or file named "${name}" already exists`, { field: "name" });
    }
    if (findView(ctx, name)) throw new HttpError(409, `a view named "${name}" already exists`, { field: "name" });
    const adopt = ctx.store.tableExists(name);
    if (adopt && !ctx.store.columns(name).has(key)) {
      throw new HttpError(400, `${name} has no column "${key}" to use as the key`, { field: "key" });
    }
    try {
      registerInConfig(ctx.configFile, [
        {
          table: name,
          path: mode === "list" ? `./${name}.yaml` : undefined,
          key,
          columns: Object.keys(columns).length > 0 ? columns : undefined,
        },
      ]);
    } catch (e) {
      throw new HttpError(400, e instanceof Error ? e.message : String(e));
    }
    if (!adopt) {
      const defs = new Map<string, ColumnType>([[key, own(columns, key) ?? "TEXT"]]);
      for (const [column, type] of Object.entries(columns)) if (column !== key) defs.set(column, type);
      writeTx(ctx.store, () => ctx.store.ensureTable(name, key, defs, new Map()));
    }
    return new Reply(201, { name });
  });
};
