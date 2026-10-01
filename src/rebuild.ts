import { decode } from "./codec.ts";
import { hashRecord } from "./hash.ts";
import type { SchemaChange } from "./indexes.ts";
import type { BaseHashes } from "./reconcile.ts";
import { isStructured } from "./schema.ts";
import { q, type Store } from "./store.ts";
import { sample } from "./text.ts";
import type { ColumnType, DbRow, DbValue, TableSpec } from "./types.ts";

export interface Alteration {
  column: string;
  from: ColumnType;
  to: ColumnType;
}

export function plannedAlterations(
  declared: Record<string, ColumnType>,
  existing: Map<string, ColumnType>,
): Alteration[] {
  return Object.entries(declared)
    .filter(([column, to]) => existing.has(column) && existing.get(column) !== to)
    .map(([column, to]) => ({ column, from: existing.get(column) as ColumnType, to }));
}

export const describeAlterations = (alterations: Alteration[]): SchemaChange[] =>
  alterations.map((a) => ({ op: "alterColumn", name: a.column, definition: `${a.from} → ${a.to}` }));

type Converted = { ok: true; value: DbValue } | { ok: false };

const INTEGER_TEXT = /^[+-]?\d+$/;

export function convertValue(value: DbValue, to: ColumnType): Converted {
  if (value === null) return { ok: true, value };
  if (value instanceof Uint8Array) return to === "TEXT" ? { ok: true, value } : { ok: false };
  switch (to) {
    case "JSON":
      return typeof value === "string" && isStructured(decode(value, "JSON")) ? { ok: true, value } : { ok: false };
    case "TEXT":
      return { ok: true, value: String(value) };
    case "INTEGER":
      if (typeof value === "bigint") return { ok: true, value };
      if (typeof value === "number" && Number.isInteger(value)) return { ok: true, value: BigInt(value) };
      return typeof value === "string" && INTEGER_TEXT.test(value.trim())
        ? { ok: true, value: BigInt(value.trim()) }
        : { ok: false };
    case "REAL": {
      if (typeof value !== "string") return { ok: true, value: Number(value) };
      const n = Number(value);
      return value.trim() !== "" && Number.isFinite(n) ? { ok: true, value: n } : { ok: false };
    }
    case "BOOLEAN": {
      const text = String(value).trim().toLowerCase();
      if (text === "1" || text === "true") return { ok: true, value: 1n };
      if (text === "0" || text === "false") return { ok: true, value: 0n };
      return { ok: false };
    }
  }
}

const UNSUPPORTED_SQL =
  /\bCHECK\b|\bREFERENCES\b|\bFOREIGN\s+KEY\b|\bGENERATED\b|\bSTRICT\b|\bWITHOUT\s+ROWID\b|\bUNIQUE\b|\bCOLLATE\b|\bAUTOINCREMENT\b/i;

function refuse(table: string, reason: string): Error {
  return new Error(`table "${table}" ${reason}; change the column type with your own migration`);
}

// Rebuilding is the only way to change a column type in SQLite. It is limited to plain tables (the ones yamlite
// creates): tables with triggers, user indexes, constraints, or other tables pointing at them are left alone.
function assertRebuildable(store: Store, table: string): void {
  for (const obj of store.query("SELECT type, name, sql FROM sqlite_schema WHERE tbl_name = ?", table)) {
    const name = String(obj.name);
    if (obj.type === "trigger") throw refuse(table, `has a trigger "${name}"`);
    if (obj.type === "index" && obj.sql !== null && !name.startsWith("yamlite_")) {
      throw refuse(table, `has an index "${name}" not managed by yamlite`);
    }
    if (obj.type === "table" && UNSUPPORTED_SQL.test(String(obj.sql))) {
      throw refuse(
        table,
        "has constraints (CHECK, UNIQUE, COLLATE, AUTOINCREMENT, foreign keys, generated columns, STRICT or WITHOUT ROWID)",
      );
    }
  }
  // the primary key's own autoindex is recreated by the rebuild; any other one backs a UNIQUE constraint
  for (const index of store.query(`PRAGMA index_list(${q(table)})`)) {
    if (index.origin === "u") throw refuse(table, `has a UNIQUE constraint ("${String(index.name)}")`);
  }
  const pointer = new RegExp(`\\bREFERENCES\\s+["\`[]?${table.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`, "i");
  for (const other of store.query("SELECT name, sql FROM sqlite_schema WHERE type = 'table' AND name != ?", table)) {
    if (pointer.test(String(other.sql))) throw refuse(table, `is referenced by table "${String(other.name)}"`);
  }
}

const show = (v: DbValue) => (typeof v === "string" ? JSON.stringify(v) : String(v));

interface ColumnInfo {
  name: string;
  type: string;
  notnull: bigint;
  dflt_value: string | null;
  pk: bigint;
}

// Rows that were in sync before the rebuild keep being in sync afterwards: YAML stays the source of truth, so a value
// that cannot be converted is cleared there and refilled from the file. A value that only exists in the DB (an unsynced
// edit) is never cleared silently; it stops the rebuild unless `forceConvert` is set.
export function rebuildTable(
  store: Store,
  spec: TableSpec,
  alterations: Alteration[],
  base: Map<string, BaseHashes>,
  inFiles: Set<string>,
  forceConvert: boolean,
): void {
  const table = spec.name;
  assertRebuildable(store, table);
  const to = new Map(alterations.map((a) => [a.column, a.to]));
  const columns = store.query(`PRAGMA table_info(${q(table)})`) as unknown as ColumnInfo[];
  const rows = store.query(`SELECT * FROM ${q(table)}`);

  const inSync = new Set<string>();
  const cleared = new Set<string>();
  const failures = new Map<string, string[]>();
  const converted: DbRow[] = [];
  for (const row of rows) {
    const keyValue = row[spec.key];
    const key = keyValue === null || keyValue === undefined ? null : String(keyValue);
    const synced = key !== null && base.get(key)?.d === hashRecord(row);
    if (synced && key !== null) inSync.add(key);
    const next: DbRow = { ...row };
    for (const [column, type] of to) {
      const result = convertValue(row[column] ?? null, type);
      if (result.ok) next[column] = result.value;
      else {
        next[column] = null;
        if (key !== null) cleared.add(key);
        if (!synced) failures.set(column, [...(failures.get(column) ?? []), `${key} (${show(row[column] ?? null)})`]);
      }
    }
    converted.push(next);
  }
  if (failures.size > 0 && !forceConvert) {
    const [column, examples] = [...failures][0] as [string, string[]];
    throw new Error(
      `cannot change "${column}" to ${to.get(column)}: ${sample(examples)} changed in the DB and cannot be converted; fix them or use --force-convert to set them to NULL`,
    );
  }

  const pks = columns.filter((c) => c.pk > 0n).sort((a, b) => Number(a.pk - b.pk));
  const defs = columns.map((c) => {
    const parts = [q(c.name), to.get(c.name) ?? c.type];
    if (pks.length === 1 && pks[0]?.name === c.name) parts.push("PRIMARY KEY");
    if (c.notnull > 0n) parts.push("NOT NULL");
    if (c.dflt_value !== null) parts.push(`DEFAULT ${c.dflt_value}`);
    return parts.filter(Boolean).join(" ");
  });
  if (pks.length > 1) defs.push(`PRIMARY KEY (${pks.map((c) => q(c.name)).join(", ")})`);

  const temp = `_yamlite_rebuild_${table}`;
  const names = columns.map((c) => c.name);
  store.exec(`CREATE TABLE ${q(temp)} (${defs.join(", ")})`);
  const insert = `INSERT INTO ${q(temp)} (${names.map(q).join(", ")}) VALUES (${names.map(() => "?").join(", ")})`;
  for (const row of converted) store.run(insert, ...names.map((n) => row[n] ?? null));
  store.exec(`DROP TABLE ${q(table)}`);
  store.exec("PRAGMA legacy_alter_table = ON");
  try {
    store.exec(`ALTER TABLE ${q(temp)} RENAME TO ${q(table)}`);
  } finally {
    store.exec("PRAGMA legacy_alter_table = OFF");
  }

  for (const row of store.query(`SELECT * FROM ${q(table)}`)) {
    const key = String(row[spec.key]);
    const before = base.get(key);
    // a cleared value makes the file look changed, so the next decision refills the row from it
    if (inSync.has(key) && before)
      store.setState(table, key, { f: cleared.has(key) && inFiles.has(key) ? null : before.f, d: hashRecord(row) });
  }
}
