import { q } from "./ident.ts";
import type { ColumnType } from "./types.ts";

// a column, or a field inside a JSON column: "metadata.status" → { column: "metadata", path: ["status"] }
export interface FieldRef {
  column: string;
  path: string[];
}

type Columns = ReadonlyMap<string, ColumnType> | Record<string, ColumnType>;

const typeOf = (columns: Columns, name: string) =>
  columns instanceof Map
    ? columns.get(name)
    : Object.hasOwn(columns, name)
      ? (columns as Record<string, ColumnType>)[name]
      : undefined;

// a name that is a column wins, so a column literally named "a.b" stays a column
export function resolveField(name: string, columns: Columns): FieldRef | null {
  if (typeOf(columns, name) !== undefined) return { column: name, path: [] };
  const dot = name.indexOf(".");
  if (dot <= 0) return null;
  const column = name.slice(0, dot);
  const path = name.slice(dot + 1).split(".");
  if (path.some((p) => p === "") || typeOf(columns, column) !== "JSON") return null;
  return { column, path };
}

export const isPath = (ref: FieldRef) => ref.path.length > 0;

const jsonPath = (path: string[]) => {
  const p = path.map((s) => `."${s.replaceAll("\\", "\\\\").replaceAll('"', '\\"')}"`).join("");
  return `'$${p.replaceAll("'", "''")}'`;
};

// "" for no table alias
const qualified = (alias: string, column: string) => (alias === "" ? q(column) : `${alias}.${q(column)}`);

export function fieldSql(alias: string, ref: FieldRef): string {
  const column = qualified(alias, ref.column);
  // json_extract fails the whole query on one row of invalid JSON; such a row reads as NULL
  return isPath(ref)
    ? `CASE WHEN json_valid(${column}) THEN json_extract(${column}, ${jsonPath(ref.path)}) END`
    : column;
}

// one row per value: one for a scalar, one per item for a list
export function fieldEach(alias: string, ref: FieldRef): string {
  return `json_each(${qualified(alias, ref.column)}, ${jsonPath(ref.path)})`;
}

const isMap = (v: unknown): v is Record<string, unknown> => v !== null && typeof v === "object" && !Array.isArray(v);

export function getField(record: Record<string, unknown>, ref: FieldRef): unknown {
  let v: unknown = Object.hasOwn(record, ref.column) ? record[ref.column] : undefined;
  for (const p of ref.path) v = isMap(v) && Object.hasOwn(v, p) ? v[p] : undefined;
  return v;
}

export function setField(record: Record<string, unknown>, ref: FieldRef, value: unknown): Record<string, unknown> {
  const put = (target: unknown, path: string[]): unknown => {
    if (path.length === 0) return value;
    const [head, ...rest] = path as [string, ...string[]];
    const base = isMap(target) ? target : {};
    return { ...base, [head]: put(base[head], rest) };
  };
  return { ...record, [ref.column]: put(record[ref.column], ref.path) };
}
