import { fieldEach, fieldSql, isPath, resolveField } from "../fieldpath.ts";
import { q, type Store } from "../store.ts";
import type { ColumnType, TableSpec } from "../types.ts";
import { decode } from "../value.ts";

export interface Split {
  column: string;
  json: boolean;
  items: Array<{ value: unknown; count: number }>;
}

// the sidebar items under a table: each value of its split column with how many records hold it
export function splitOf(store: Store, spec: TableSpec, columns: Record<string, ColumnType>): Split | null {
  if (spec.split === null) return null;
  const column = spec.split;
  const ref = resolveField(column, columns);
  const path = ref !== null && isPath(ref);
  const type = path ? "JSON" : columns[column];
  const json = type === "JSON";
  if (ref === null || type === undefined || !store.tableExists(spec.name)) return { column, json, items: [] };
  const t = q(spec.name);
  const c = fieldSql(t, ref);
  try {
    const rows = path
      ? store.query(
          `SELECT j.value AS value, count(DISTINCT ${t}.${q(spec.key)}) AS n FROM ${t}, ${fieldEach(t, ref)} AS j
           WHERE json_valid(${t}.${q(ref.column)}) AND j.type NOT IN ('object', 'array', 'null')
           GROUP BY j.value ORDER BY j.value`,
        )
      : json
        ? store.query(
            `SELECT j.value AS value, count(DISTINCT ${t}.${q(spec.key)}) AS n FROM ${t}, json_each(${c}) AS j
           WHERE json_valid(${c}) AND json_type(${c}) = 'array' GROUP BY j.value ORDER BY j.value`,
          )
        : store.query(
            `SELECT ${c} AS value, count(*) AS n FROM ${t} WHERE ${c} IS NOT NULL GROUP BY ${c} ORDER BY ${c}`,
          );
    const none = Number(store.query(`SELECT count(*) AS n FROM ${t} WHERE ${c} IS NULL`)[0]?.n ?? 0);
    const items = rows.map((r) => ({ value: decode(r.value ?? null, json ? "TEXT" : type), count: Number(r.n) }));
    return { column, json, items: none > 0 ? [...items, { value: null, count: none }] : items };
  } catch {
    // a column changed under the table counts as empty until the next sync rebuilds it
    return { column, json, items: [] };
  }
}
