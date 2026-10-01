import { hashRecord } from "./hash.ts";
import type { SchemaChange } from "./indexes.ts";
import { type Alteration, describeAlterations, plannedAlterations, rebuildTable } from "./rebuild.ts";
import type { BaseHashes } from "./reconcile.ts";
import type { SourceRead } from "./source/types.ts";
import { q, type Store } from "./store.ts";
import { sample } from "./text.ts";
import type { ColumnType, DbRow, TableSpec } from "./types.ts";

export interface Schema {
  tableExists: boolean;
  // the table's columns once the declared types are applied and removed declarations are dropped
  existing: Map<string, ColumnType>;
  base: Map<string, BaseHashes>;
  // yamlite.yaml is the schema of record only when changes to it are persisted (root mode)
  declarative: boolean;
  // columns that yamlite.yaml declared at the last sync
  recorded: Set<string>;
  alterations: Alteration[];
  changes: SchemaChange[];
  warnings: string[];
}

// Drops a column whose declaration was removed, together with the managed indexes that use it.
// Returns the dropped index names; throws when SQLite refuses.
function dropColumn(store: Store, table: string, column: string): string[] {
  const uses = new RegExp(`(^|[^\\w])"?${column.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}"?([^\\w]|$)`);
  const indexes = store
    .query("SELECT name, sql FROM sqlite_schema WHERE type = 'index' AND tbl_name = ? AND name GLOB 'yamlite_*'", table)
    .filter((row) => uses.test(String(row.sql).replace(/^[^(]*\(/, "")))
    .map((row) => String(row.name));
  for (const name of indexes) store.exec(`DROP INDEX ${q(name)}`);
  store.exec(`ALTER TABLE ${q(table)} DROP COLUMN ${q(column)}`);
  return indexes;
}

function assertSyncable(store: Store, spec: TableSpec, files: SourceRead, base: Map<string, BaseHashes>): void {
  if (!files.exists && base.size > 0) {
    throw new Error(
      `${spec.path} does not exist but ${base.size} records were synced before; refusing to delete them (restore the path, or delete the database to start over)`,
    );
  }
  if (!store.tableExists(spec.name) && base.size > 0) {
    throw new Error(
      `table "${spec.name}" does not exist but ${base.size} records were synced before; refusing to delete files`,
    );
  }
  if (files.tableError) throw new Error(files.tableError);
}

// Brings the table's columns in line with yamlite.yaml: changes declared types and drops columns whose declaration
// was removed. A dry run only describes the changes.
export function migrateSchema(
  store: Store,
  spec: TableSpec,
  files: SourceRead,
  opts: { dryRun: boolean; forceConvert: boolean; declarative: boolean },
): Schema {
  let base = store.getState(spec.name);
  assertSyncable(store, spec, files, base);
  const tableExists = store.tableExists(spec.name);
  let existing = tableExists ? store.columns(spec.name) : new Map<string, ColumnType>();
  if (tableExists && !existing.has(spec.key)) throw new Error(`table "${spec.name}" has no key column "${spec.key}"`);
  const keyType = spec.columns[spec.key];
  if (tableExists && keyType !== undefined && keyType !== existing.get(spec.key)) {
    throw new Error(
      `cannot change the type of key column "${spec.key}"; recreate the database (delete .yamlite/) to change it`,
    );
  }
  const changes: SchemaChange[] = [];
  const warnings: string[] = [];
  const alterations = plannedAlterations(spec.columns, existing).filter((a) => a.column !== spec.key);
  if (alterations.length > 0) {
    if (opts.dryRun) existing = new Map([...existing, ...alterations.map((a) => [a.column, a.to] as const)]);
    else {
      const inFiles = new Set([...files.records.keys(), ...files.skip]);
      rebuildTable(store, spec, alterations, base, inFiles, opts.forceConvert);
      existing = store.columns(spec.name);
      base = store.getState(spec.name);
    }
    changes.push(...describeAlterations(alterations));
  }
  const recorded = opts.declarative && tableExists ? store.recordedColumns(spec.name) : new Set<string>();
  for (const column of Array.from(existing.keys())) {
    if (column === spec.key || column in spec.columns || !recorded.has(column)) continue;
    const removal = removalOf(store, spec, files, base, column);
    if (removal === "later") continue;
    if (removal !== "drop") {
      warnings.push(removal.warning);
      continue;
    }
    if (!opts.dryRun) {
      try {
        const dropped = dropColumn(store, spec.name, column);
        changes.push({ op: "dropColumn", name: column, definition: column });
        for (const name of dropped) changes.push({ op: "dropIndex", name, definition: name });
      } catch (e) {
        warnings.push(`could not drop column "${column}": ${e instanceof Error ? e.message : String(e)}`);
        continue;
      }
    } else changes.push({ op: "dropColumn", name: column, definition: column });
    existing.delete(column);
  }
  return { tableExists, existing, base, declarative: opts.declarative, recorded, alterations, changes, warnings };
}

type Removal = "drop" | "later" | { warning: string };

// whether a column whose declaration was removed can be dropped now
function removalOf(
  store: Store,
  spec: TableSpec,
  files: SourceRead,
  base: Map<string, BaseHashes>,
  column: string,
): Removal {
  const users = [...files.records].filter(([, r]) => r[column] !== null && r[column] !== undefined);
  if (users.length > 0) {
    return {
      warning: `"${column}" was removed from yamlite.yaml but files still use it (${sample(users.map(([key]) => key))}); remove it from those files or add it back`,
    };
  }
  if (files.skip.size > 0) {
    return {
      warning: `"${column}" was removed from yamlite.yaml but some files could not be read (${sample([...files.skip])}); fix them, or add it back`,
    };
  }
  const rows = store.query(`SELECT * FROM ${q(spec.name)} WHERE ${q(column)} IS NOT NULL`);
  // a file that just dropped the field clears it in this sync; the column goes in the next one
  const clearing = (row: DbRow) => {
    const key = String(row[spec.key]);
    const record = files.records.get(key);
    const before = base.get(key);
    return record !== undefined && before?.d === hashRecord(row) && before.f !== hashRecord(record);
  };
  if (rows.length > 0 && rows.every(clearing)) return "later";
  const held = rows.filter((row) => !clearing(row)).map((row) => String(row[spec.key]));
  if (held.length > 0) {
    return {
      warning: `"${column}" was removed from yamlite.yaml but rows still hold values (${sample(held)}); sync them to files or clear the column, or add it back`,
    };
  }
  return "drop";
}
