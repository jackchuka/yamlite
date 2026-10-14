import { fieldSql, resolveField } from "./fieldpath.ts";
import { boundProblem, formatProblem } from "./rules.ts";
import { q, type Store } from "./store.ts";
import { sample } from "./text.ts";
import { isShape, type Bound, type ColumnFormat, type ColumnType, type DbValue, type TableSpec } from "./types.ts";
import { decode } from "./value.ts";
import { declaredViews } from "./views.ts";

const MAX_WARNINGS = 10;

interface Rules {
  formats: Record<string, ColumnFormat>;
  min: Record<string, Bound>;
  max: Record<string, Bound>;
}

interface Target {
  name: string;
  columns: Map<string, ColumnType>;
  // the columns that name a row in warnings, joined with "/"
  label: string[];
  rules: Rules;
  prefix: string;
}

const own = <T>(record: Record<string, T>, key: string): T | undefined =>
  Object.hasOwn(record, key) ? record[key] : undefined;

const checkedColumns = (r: Rules) => Object.keys(r.formats).filter((c) => r.formats[c] !== "markdown");
const boundedColumns = (r: Rules) => [...new Set([...Object.keys(r.min), ...Object.keys(r.max)])];

// a table and its views that have something to check
function targets(store: Store, spec: TableSpec, pick: (r: Rules) => string[]): Target[] {
  const found: Target[] = [];
  if (pick(spec).length > 0 && store.tableExists(spec.name)) {
    found.push({
      name: spec.name,
      columns: store.columns(spec.name),
      label: [spec.key],
      rules: spec,
      prefix: "",
    });
  }
  for (const { spec: view } of declaredViews(spec)) {
    const record = pick(view).length > 0 ? store.registeredView(view.name) : undefined;
    if (!record || store.objectType(view.name) !== "view") continue;
    found.push({
      name: view.name,
      columns: new Map(Object.entries(record.columns)),
      label: record.identity,
      rules: view,
      prefix: `${view.name}: `,
    });
  }
  return found;
}

const shown = (v: unknown) =>
  typeof v === "string" || (v !== null && typeof v === "object") ? JSON.stringify(v) : String(v);

// one warning per value and problem, naming the rows that have it
function scan(
  store: Store,
  t: Target,
  column: string,
  problem: (v: unknown) => string | null,
  read: (v: DbValue) => unknown = (v) => v,
): string[] {
  const ref = resolveField(column, t.columns);
  if (ref === null) return [];
  const value = fieldSql("src", ref);
  const label = t.label.map((col) => `COALESCE(CAST(src.${q(col)} AS TEXT), '')`).join(" || '/' || ");
  const rows = store.query(
    `SELECT ${label} AS k, ${value} AS v FROM ${q(t.name)} AS src WHERE ${value} IS NOT NULL ORDER BY v, k`,
  );
  const grouped = new Map<string, string[]>();
  for (const row of rows) {
    const v = read(row.v ?? null);
    const p = problem(v);
    if (p === null) continue;
    const message = `${t.prefix}${column} ${shown(v)} ${p}`;
    grouped.set(message, [...(grouped.get(message) ?? []), String(row.k)]);
  }
  return [...grouped].map(([message, keys]) => `${message} (${sample(keys)})`);
}

const capped = (warnings: string[], kind: string) =>
  warnings.length > MAX_WARNINGS
    ? [...warnings.slice(0, MAX_WARNINGS), `… and ${warnings.length - MAX_WARNINGS} more ${kind} warnings`]
    : warnings;

// Formats and bounds are checked, never enforced: a value that breaks them is a warning.
// A table's views are checked with it, their warnings prefixed with the view's name.
export function checkFormats(store: Store, spec: TableSpec): string[] {
  const warnings = targets(store, spec, checkedColumns).flatMap((t) =>
    checkedColumns(t.rules).flatMap((column) => {
      const format = own(t.rules.formats, column);
      // a list or a map is JSON text, in a JSON column and in a view's column alike
      const read = isShape(format) ? (v: DbValue) => decode(v, "JSON") : undefined;
      return scan(store, t, column, (v) => formatProblem(v, format), read);
    }),
  );
  return capped(warnings, "format");
}

export function checkBounds(store: Store, spec: TableSpec): string[] {
  const warnings = targets(store, spec, boundedColumns).flatMap((t) =>
    boundedColumns(t.rules).flatMap((column) =>
      scan(store, t, column, (v) =>
        boundProblem(v, own(t.rules.formats, column), own(t.rules.min, column), own(t.rules.max, column)),
      ),
    ),
  );
  return capped(warnings, "range");
}
