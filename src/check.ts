import { resolve } from "node:path";
import { configPath, listedTables } from "./config.ts";
import type { Registered } from "./engine.ts";
import { withScratch } from "./scratch.ts";

export interface CheckTable {
  table: string;
  ok: boolean;
  error?: string;
  warnings: string[];
  // columns found in the data that yamlite.yaml does not list
  unregistered: Registered[];
}

export interface CheckResult {
  ok: boolean;
  tables: CheckTable[];
  // tables found by the folder conventions that yamlite.yaml does not list
  unregisteredTables: string[];
}

// syncs root into a throwaway database and reports every error, warning and schema addition as a problem
export async function check(opts: { root: string; tables?: string[] }): Promise<CheckResult> {
  const root = resolve(opts.root);
  return withScratch(root, "yamlite-check-", async ({ y }) => {
    const listed = new Set(Object.keys(listedTables(configPath(root) as string)));
    const selected = opts.tables && opts.tables.length > 0 ? opts.tables : undefined;
    const results = await y.sync({ tables: selected });
    const tables: CheckTable[] = results.map((r) => ({
      table: r.table,
      ok: r.ok,
      ...(r.error !== undefined ? { error: r.error } : {}),
      warnings: r.warnings,
      unregistered: r.registered,
    }));
    const unregisteredTables = y.tables
      .filter((t) => t.persisted && !listed.has(t.name) && (!selected || selected.includes(t.name)))
      .map((t) => t.name);
    const ok =
      unregisteredTables.length === 0 &&
      tables.every((t) => t.ok && t.warnings.length === 0 && t.unregistered.length === 0);
    return { ok, tables, unregisteredTables };
  });
}
