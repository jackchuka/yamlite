import { existsSync } from "node:fs";
import { join } from "node:path";
import { registerInConfig, setTableGroup } from "../../configfile.ts";
import { COLUMN_TYPES, type ColumnType, own } from "../../types.ts";
import { type ApiContext, findView, tableSpec } from "../context.ts";
import { HttpError, Reply } from "../http.ts";
import { objectBody, writeTx } from "../write.ts";
import type { Routes } from "./index.ts";

const NAME = /^[A-Za-z_][A-Za-z0-9_-]*$/;

// a blank group means none
function groupOf(value: unknown): string | null {
  if (value === null) return null;
  if (typeof value !== "string") throw new HttpError(400, "group must be a string or null", { field: "group" });
  return value.trim() === "" ? null : value.trim();
}

function configWrite<T>(write: () => T): T {
  try {
    return write();
  } catch (e) {
    throw new HttpError(400, e instanceof Error ? e.message : String(e));
  }
}

export interface NewTableSpec {
  name: string;
  mode: "files" | "list";
  key: string;
  columns: Record<string, ColumnType>;
  group: string | null;
}

export function validateNewTable(ctx: ApiContext, b: Record<string, unknown>): NewTableSpec & { adopt: boolean } {
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
  const group = b.group === undefined ? null : groupOf(b.group);
  const onDisk = [name, `${name}.yaml`, `${name}.yml`].some((entry) => existsSync(join(ctx.root, entry)));
  if (ctx.y.tables.some((t) => t.name === name) || onDisk) {
    throw new HttpError(409, `a table or file named "${name}" already exists`, { field: "name" });
  }
  if (findView(ctx, name)) throw new HttpError(409, `a view named "${name}" already exists`, { field: "name" });
  const adopt = ctx.store.tableExists(name);
  if (adopt && !ctx.store.columns(name).has(key)) {
    throw new HttpError(400, `${name} has no column "${key}" to use as the key`, { field: "key" });
  }
  return { name, mode, key, columns, group, adopt };
}

export function createTable(ctx: ApiContext, b: Record<string, unknown>): string {
  const { name, mode, key, columns, group, adopt } = validateNewTable(ctx, b);
  configWrite(() =>
    registerInConfig(ctx.configFile, [
      {
        table: name,
        path: mode === "list" ? `./${name}.yaml` : undefined,
        key,
        columns: Object.keys(columns).length > 0 ? columns : undefined,
        group: group ?? undefined,
      },
    ]),
  );
  if (!adopt) {
    const defs = new Map<string, ColumnType>([[key, own(columns, key) ?? "TEXT"]]);
    for (const [column, type] of Object.entries(columns)) if (column !== key) defs.set(column, type);
    writeTx(ctx.store, () => ctx.store.ensureTable(name, key, defs, new Map()));
  }
  return name;
}

export const tableRoutes: Routes = (router, ctx) => {
  router.add("POST", "/api/tables", ({ body }) => new Reply(201, { name: createTable(ctx, objectBody(body, "body")) }));

  router.add("PATCH", "/api/tables/:table", ({ params, body }) => {
    const spec = tableSpec(ctx, params.table ?? "");
    const b = objectBody(body, "body");
    if (!("group" in b)) throw new HttpError(400, "group is required", { field: "group" });
    const group = groupOf(b.group);
    configWrite(() => setTableGroup(ctx.configFile, spec.name, group));
    return { name: spec.name, group };
  });
};
