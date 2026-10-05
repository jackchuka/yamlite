import { q, type Store } from "./store.ts";
import { sample } from "./text.ts";
import type { TableSpec } from "./types.ts";
import { declaredViews } from "./views.ts";

const MAX_WARNINGS = 10;

interface Checked {
  name: string;
  columns: Set<string>;
  // the columns that name a row in warnings, joined with "/"
  label: string[];
  required: string[];
  prefix: string;
}

function check(store: Store, c: Checked): string[] {
  const label = c.label.map((col) => `COALESCE(CAST(src.${q(col)} AS TEXT), '')`).join(" || '/' || ");
  const warnings: string[] = [];
  for (const column of c.required) {
    if (c.label.includes(column)) continue;
    // a column no record has yet is missing from every record
    const where = c.columns.has(column) ? ` WHERE src.${q(column)} IS NULL` : "";
    const keys = store
      .query(`SELECT ${label} AS k FROM ${q(c.name)} AS src${where} ORDER BY k`)
      .map((r) => String(r.k));
    if (keys.length > 0) warnings.push(`${c.prefix}${column} missing (${sample(keys)})`);
  }
  return warnings;
}

// Required columns are checked, never enforced: a record without a value (NULL) is a warning.
// A table's views are checked with it, their warnings prefixed with the view's name.
export function checkRequired(store: Store, spec: TableSpec): string[] {
  const checked: Checked[] = [];
  if (spec.required.length > 0 && store.tableExists(spec.name)) {
    checked.push({
      name: spec.name,
      columns: new Set(store.columns(spec.name).keys()),
      label: [spec.key],
      required: spec.required,
      prefix: "",
    });
  }
  for (const { spec: view } of declaredViews(spec)) {
    const record = view.required.length > 0 ? store.registeredView(view.name) : undefined;
    if (!record || store.objectType(view.name) !== "view") continue;
    checked.push({
      name: view.name,
      columns: new Set(Object.keys(record.columns)),
      label: record.identity,
      required: view.required,
      prefix: `${view.name}: `,
    });
  }
  const warnings = checked.flatMap((c) => check(store, c));
  if (warnings.length > MAX_WARNINGS) {
    return [...warnings.slice(0, MAX_WARNINGS), `… and ${warnings.length - MAX_WARNINGS} more required warnings`];
  }
  return warnings;
}
