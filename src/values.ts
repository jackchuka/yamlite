import { q, type Store } from "./store.ts";
import { sample } from "./text.ts";
import type { AllowedValue, ColumnType, TableSpec } from "./types.ts";
import { declaredViews } from "./views.ts";

const MAX_WARNINGS = 10;

// how a value compares: as text, with booleans as the 1/0 a BOOLEAN column stores
export const valueText = (v: AllowedValue): string => (v === true ? "1" : v === false ? "0" : String(v));

interface Checked {
  name: string;
  columns: Map<string, ColumnType>;
  // the columns that name a row in warnings, joined with "/"
  label: string[];
  values: Record<string, AllowedValue[]>;
  prefix: string;
}

function check(store: Store, c: Checked): string[] {
  const warnings: string[] = [];
  const label = c.label.map((col) => `CAST(src.${q(col)} AS TEXT)`).join(" || '/' || ");
  for (const [column, allowed] of Object.entries(c.values)) {
    if (!c.columns.has(column)) continue;
    const source = `src.${q(column)}`;
    const json = c.columns.get(column) === "JSON";
    const value = json ? "item.value" : source;
    const from = json
      ? `${q(c.name)} AS src, json_each(${source}) AS item WHERE json_valid(${source}) AND item.type NOT IN ('object', 'array', 'null')`
      : `${q(c.name)} AS src WHERE ${source} IS NOT NULL`;
    const texts = allowed.map(valueText);
    // 2.0 in a REAL column is "2.0" as text, so numbers are also compared as numbers
    const numbers = allowed.filter((v): v is number => typeof v === "number");
    const marks = (n: number) => Array.from({ length: n }, () => "?").join(", ");
    const asNumber =
      numbers.length > 0
        ? ` OR (typeof(${value}) IN ('integer', 'real') AND ${value} IN (${marks(numbers.length)}))`
        : "";
    const rows = store.query(
      `SELECT ${label} AS k, CAST(${value} AS TEXT) AS v FROM ${from}
       AND NOT (CAST(${value} AS TEXT) IN (${marks(texts.length)})${asNumber})
       ORDER BY v, k`,
      ...texts,
      ...numbers,
    );
    const byValue = new Map<string, string[]>();
    for (const row of rows) {
      const v = String(row.v);
      byValue.set(v, [...(byValue.get(v) ?? []), String(row.k)]);
    }
    for (const [v, keys] of byValue) {
      warnings.push(`${c.prefix}${column} ${JSON.stringify(v)} not in values (${sample(keys)})`);
    }
  }
  return warnings;
}

// Values are checked, never enforced: a value outside its column's list is a warning.
// A table's views are checked with it, their warnings prefixed with the view's name.
export function checkValues(store: Store, spec: TableSpec): string[] {
  const checked: Checked[] = [];
  if (Object.keys(spec.values).length > 0 && store.tableExists(spec.name)) {
    checked.push({
      name: spec.name,
      columns: store.columns(spec.name),
      label: [spec.key],
      values: spec.values,
      prefix: "",
    });
  }
  for (const { spec: view } of declaredViews(spec)) {
    const record = Object.keys(view.values).length > 0 ? store.registeredView(view.name) : undefined;
    if (!record || store.objectType(view.name) !== "view") continue;
    checked.push({
      name: view.name,
      columns: new Map(Object.entries(record.columns)),
      label: record.identity,
      values: view.values,
      prefix: `${view.name}: `,
    });
  }
  const warnings = checked.flatMap((c) => check(store, c));
  if (warnings.length > MAX_WARNINGS) {
    return [...warnings.slice(0, MAX_WARNINGS), `… and ${warnings.length - MAX_WARNINGS} more value warnings`];
  }
  return warnings;
}
