import { q, type Store } from "./store.ts";
import { sample } from "./text.ts";
import type { TableSpec } from "./types.ts";

const MAX_WARNINGS = 10;

// References are checked, never enforced: a value with no matching row in the referenced table is a warning.
// Values are compared as text so that "1" in one table matches 1 in another; list values are checked one by one.
export function checkReferences(store: Store, spec: TableSpec, tables: readonly TableSpec[]): string[] {
  const warnings: string[] = [];
  if (spec.references.length === 0 || !store.tableExists(spec.name)) return warnings;
  const columns = store.columns(spec.name);
  for (const ref of spec.references) {
    const target = tables.find((t) => t.name === ref.table);
    if (!target) {
      warnings.push(`references.${ref.column}: table "${ref.table}" is not in yamlite.yaml`);
      continue;
    }
    const targetColumn = ref.target ?? target.key;
    if (!store.tableExists(target.name) || !columns.has(ref.column)) continue;
    if (!store.columns(target.name).has(targetColumn)) {
      warnings.push(`references.${ref.column}: column "${targetColumn}" not found in ${target.name}`);
      continue;
    }
    const source = `${q(spec.name)}.${q(ref.column)}`;
    const value = columns.get(ref.column) === "JSON" ? "item.value" : source;
    const from =
      columns.get(ref.column) === "JSON"
        ? `${q(spec.name)}, json_each(${source}) AS item WHERE json_valid(${source}) AND item.type NOT IN ('object', 'array', 'null')`
        : `${q(spec.name)} WHERE ${source} IS NOT NULL`;
    const rows = store.query(
      `SELECT CAST(${q(spec.name)}.${q(spec.key)} AS TEXT) AS k, CAST(${value} AS TEXT) AS v FROM ${from}
       AND NOT EXISTS (SELECT 1 FROM ${q(target.name)} WHERE CAST(${q(target.name)}.${q(targetColumn)} AS TEXT) = CAST(${value} AS TEXT))
       ORDER BY v, k`,
    );
    const byValue = new Map<string, string[]>();
    for (const row of rows) {
      const v = String(row.v);
      byValue.set(v, [...(byValue.get(v) ?? []), String(row.k)]);
    }
    for (const [v, keys] of byValue) {
      warnings.push(`${ref.column} ${JSON.stringify(v)} not found in ${target.name}.${targetColumn} (${sample(keys)})`);
    }
  }
  if (warnings.length > MAX_WARNINGS) {
    return [...warnings.slice(0, MAX_WARNINGS), `… and ${warnings.length - MAX_WARNINGS} more reference warnings`];
  }
  return warnings;
}

export const referrersOf = (table: string, tables: readonly TableSpec[]) =>
  tables.filter((t) => t.name !== table && t.references.some((r) => r.table === table));
