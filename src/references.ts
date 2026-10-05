import { q, type Store } from "./store.ts";
import { sample } from "./text.ts";
import type { ColumnType, Reference, TableSpec } from "./types.ts";
import { declaredViews } from "./views.ts";

const MAX_WARNINGS = 10;

interface Checked {
  name: string;
  columns: Map<string, ColumnType>;
  // the columns that name a row in warnings, joined with "/"
  label: string[];
  references: Reference[];
  prefix: string;
}

function check(store: Store, c: Checked, tables: readonly TableSpec[]): string[] {
  const warnings: string[] = [];
  // the checked table is aliased "src" and the referenced one "dst", so a table that references itself
  // still compares a row's value against the other rows rather than against itself
  const label = c.label.map((col) => `CAST(src.${q(col)} AS TEXT)`).join(" || '/' || ");
  for (const ref of c.references) {
    const target = tables.find((t) => t.name === ref.table);
    if (!target) {
      warnings.push(`${c.prefix}references.${ref.column}: table "${ref.table}" is not in yamlite.yaml`);
      continue;
    }
    const targetColumn = ref.target ?? target.key;
    if (!store.tableExists(target.name) || !c.columns.has(ref.column)) continue;
    if (!store.columns(target.name).has(targetColumn)) {
      warnings.push(`${c.prefix}references.${ref.column}: column "${targetColumn}" not found in ${target.name}`);
      continue;
    }
    const source = `src.${q(ref.column)}`;
    const json = c.columns.get(ref.column) === "JSON";
    const value = json ? "item.value" : source;
    const from = json
      ? `${q(c.name)} AS src, json_each(${source}) AS item WHERE json_valid(${source}) AND item.type NOT IN ('object', 'array', 'null')`
      : `${q(c.name)} AS src WHERE ${source} IS NOT NULL`;
    const rows = store.query(
      `SELECT ${label} AS k, CAST(${value} AS TEXT) AS v FROM ${from}
       AND NOT EXISTS (SELECT 1 FROM ${q(target.name)} AS dst WHERE CAST(dst.${q(targetColumn)} AS TEXT) = CAST(${value} AS TEXT))
       ORDER BY v, k`,
    );
    const byValue = new Map<string, string[]>();
    for (const row of rows) {
      const v = String(row.v);
      byValue.set(v, [...(byValue.get(v) ?? []), String(row.k)]);
    }
    for (const [v, keys] of byValue) {
      warnings.push(
        `${c.prefix}${ref.column} ${JSON.stringify(v)} not found in ${target.name}.${targetColumn} (${sample(keys)})`,
      );
    }
  }
  return warnings;
}

// References are checked, never enforced: a value with no matching row in the referenced table is a warning.
// Values are compared as text so that "1" in one table matches 1 in another; list values are checked one by one.
// A table's views are checked with it, their warnings prefixed with the view's name.
export function checkReferences(store: Store, spec: TableSpec, tables: readonly TableSpec[]): string[] {
  const checked: Checked[] = [];
  if (spec.references.length > 0 && store.tableExists(spec.name)) {
    checked.push({
      name: spec.name,
      columns: store.columns(spec.name),
      label: [spec.key],
      references: spec.references,
      prefix: "",
    });
  }
  for (const { spec: view } of declaredViews(spec)) {
    const record = view.references.length > 0 ? store.registeredView(view.name) : undefined;
    if (!record || store.objectType(view.name) !== "view") continue;
    checked.push({
      name: view.name,
      columns: new Map(Object.entries(record.columns)),
      label: record.identity,
      references: view.references,
      prefix: `${view.name}: `,
    });
  }
  const warnings = checked.flatMap((c) => check(store, c, tables));
  if (warnings.length > MAX_WARNINGS) {
    return [...warnings.slice(0, MAX_WARNINGS), `… and ${warnings.length - MAX_WARNINGS} more reference warnings`];
  }
  return warnings;
}

const allReferences = (t: TableSpec) => [...t.references, ...declaredViews(t).flatMap((v) => v.spec.references)];

export const referrersOf = (table: string, tables: readonly TableSpec[]) =>
  tables.filter((t) => t.name !== table && allReferences(t).some((r) => r.table === table));
