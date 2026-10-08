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
  const type = columns[column];
  const json = type === "JSON";
  if (type === undefined || !store.tableExists(spec.name)) return { column, json, items: [] };
  const t = q(spec.name);
  const c = `${t}.${q(column)}`;
  try {
    const rows = json
      ? store.query(
          `SELECT j.value AS value, count(DISTINCT ${t}.${q(spec.key)}) AS n FROM ${t}, json_each(${c}) AS j
           WHERE json_valid(${c}) AND json_type(${c}) = 'array' GROUP BY j.value ORDER BY j.value`,
        )
      : store.query(`SELECT ${c} AS value, count(*) AS n FROM ${t} WHERE ${c} IS NOT NULL GROUP BY ${c} ORDER BY ${c}`);
    const none = Number(store.query(`SELECT count(*) AS n FROM ${t} WHERE ${c} IS NULL`)[0]?.n ?? 0);
    const items = rows.map((r) => ({ value: decode(r.value ?? null, json ? "TEXT" : type), count: Number(r.n) }));
    return { column, json, items: none > 0 ? [...items, { value: null, count: none }] : items };
  } catch {
    // a column changed under the table counts as empty until the next sync rebuilds it
    return { column, json, items: [] };
  }
}
