import { createHash } from "node:crypto";
import { q, type Store } from "./store.ts";
import type { IndexSpec } from "./types.ts";

export interface SchemaChange {
  op: "createIndex" | "dropIndex" | "alterColumn" | "dropColumn" | "createView" | "dropView";
  name: string;
  definition: string;
}

export const MANAGED_PREFIX = "yamlite_";

// the name is derived from the declaration, so a changed declaration is a different index
export function indexName(table: string, spec: IndexSpec): string {
  const id = JSON.stringify([spec.columns ?? null, spec.expr ?? null, spec.unique]);
  return `${MANAGED_PREFIX}${table}_${createHash("sha256").update(id).digest("hex").slice(0, 10)}`;
}

export function describeIndex(spec: IndexSpec): string {
  return `${spec.unique ? "unique " : ""}(${spec.columns ? spec.columns.join(", ") : spec.expr})`;
}

function createSql(table: string, name: string, spec: IndexSpec): string {
  const target = spec.columns ? spec.columns.map(q).join(", ") : spec.expr;
  return `CREATE ${spec.unique ? "UNIQUE " : ""}INDEX ${q(name)} ON ${q(table)} (${target})`;
}

export interface IndexPlan {
  changes: SchemaChange[];
  warnings: string[];
}

// Makes the table's managed indexes match the declarations. Indexes created outside yamlite are never touched.
// An index that cannot be created is reported as a warning so that data keeps syncing.
export function reconcileIndexes(
  store: Store,
  table: string,
  declared: IndexSpec[],
  columns: Set<string>,
  apply: boolean,
): IndexPlan {
  const plan: IndexPlan = { changes: [], warnings: [] };
  const existing = store.tableExists(table) ? store.managedIndexes(table) : new Set<string>();
  const desired = new Map(declared.map((spec) => [indexName(table, spec), spec]));

  for (const name of existing) {
    if (desired.has(name)) continue;
    if (apply) store.exec(`DROP INDEX ${q(name)}`);
    plan.changes.push({ op: "dropIndex", name, definition: name });
  }
  for (const [name, spec] of desired) {
    if (existing.has(name)) continue;
    const definition = describeIndex(spec);
    const missing = spec.columns?.find((c) => !columns.has(c));
    if (missing !== undefined) {
      plan.warnings.push(`index ${definition} not created: no column "${missing}"`);
      continue;
    }
    if (apply) {
      try {
        store.run(createSql(table, name, spec));
      } catch (e) {
        plan.warnings.push(`index ${definition} not created: ${e instanceof Error ? e.message : String(e)}`);
        continue;
      }
    }
    plan.changes.push({ op: "createIndex", name, definition });
  }
  return plan;
}
