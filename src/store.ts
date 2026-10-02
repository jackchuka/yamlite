import { mkdirSync, statSync } from "node:fs";
import { dirname } from "node:path";
import { DatabaseSync } from "node:sqlite";
import type { BaseHashes } from "./reconcile.ts";
import { logicalType } from "./schema.ts";
import type { ColumnType, DbRow, DbValue, ViewRecord } from "./types.ts";

export const q = (id: string): string => `"${id.replaceAll('"', '""')}"`;

interface RawView {
  name: string;
  tbl: string;
  parent: string;
  columns: string;
  identity: string;
}

const toViewRecord = (r: RawView): ViewRecord => ({
  name: r.name,
  table: r.tbl,
  parent: r.parent,
  columns: JSON.parse(r.columns) as ViewRecord["columns"],
  identity: JSON.parse(r.identity) as string[],
});

export class BusyError extends Error {}

export function isConstraintError(e: unknown): e is Error {
  if (!(e instanceof Error)) return false;
  const { errcode } = e as { errcode?: number };
  return typeof errcode === "number" && (errcode & 0xff) === 19;
}

export interface ExecResult {
  columns: string[] | null;
  rows: DbRow[];
  changes: number;
  truncated: boolean;
}

export interface DbRead {
  rows: Map<string, DbRow>;
  skip: Set<string>;
  nullKeys: number;
}

function isBusy(e: unknown): boolean {
  if (typeof e !== "object" || e === null) return false;
  const { errcode, message } = e as { errcode?: number; message?: string };
  return errcode === 5 || /database is locked/.test(message ?? "");
}

export class Store {
  private readonly db: DatabaseSync;

  constructor(
    private readonly path: string,
    opts: { busyTimeoutMs?: number } = {},
  ) {
    mkdirSync(dirname(path), { recursive: true });
    this.db = new DatabaseSync(path);
    this.db.exec(`PRAGMA busy_timeout = ${opts.busyTimeoutMs ?? 5000}`);
    this.db.exec("PRAGMA journal_mode = WAL");
    this.db.exec(
      "CREATE TABLE IF NOT EXISTS _yamlite_state (tbl TEXT NOT NULL, key TEXT NOT NULL, file_hash TEXT, db_hash TEXT, synced_at INTEGER NOT NULL, PRIMARY KEY (tbl, key))",
    );
    // columns that yamlite.yaml declared at the last sync, to tell a removed declaration from a column an app added
    this.db.exec(
      "CREATE TABLE IF NOT EXISTS _yamlite_columns (tbl TEXT NOT NULL, col TEXT NOT NULL, PRIMARY KEY (tbl, col))",
    );
    // views yamlite created from expand declarations, with the column types it inferred for them
    this.db.exec(
      "CREATE TABLE IF NOT EXISTS _yamlite_views (name TEXT PRIMARY KEY, tbl TEXT NOT NULL, parent TEXT NOT NULL, columns TEXT NOT NULL, identity TEXT NOT NULL)",
    );
  }

  registeredViews(table: string): ViewRecord[] {
    const rows = this.db.prepare("SELECT * FROM _yamlite_views WHERE tbl = ? ORDER BY rowid").all(table);
    return (rows as unknown as RawView[]).map(toViewRecord);
  }

  registeredView(name: string): ViewRecord | undefined {
    const row = this.db.prepare("SELECT * FROM _yamlite_views WHERE name = ?").get(name);
    return row ? toViewRecord(row as unknown as RawView) : undefined;
  }

  registerView(v: ViewRecord): void {
    this.db
      .prepare(
        "INSERT INTO _yamlite_views (name, tbl, parent, columns, identity) VALUES (?, ?, ?, ?, ?) ON CONFLICT (name) DO UPDATE SET tbl = excluded.tbl, parent = excluded.parent, columns = excluded.columns, identity = excluded.identity",
      )
      .run(v.name, v.table, v.parent, JSON.stringify(v.columns), JSON.stringify(v.identity));
  }

  unregisterView(name: string): void {
    this.db.prepare("DELETE FROM _yamlite_views WHERE name = ?").run(name);
  }

  objectType(name: string): "table" | "view" | null {
    const row = this.db
      .prepare("SELECT type FROM sqlite_schema WHERE name = ? AND type IN ('table', 'view')")
      .get(name);
    return (row as { type: "table" | "view" } | undefined)?.type ?? null;
  }

  viewSql(name: string): string | null {
    const row = this.db.prepare("SELECT sql FROM sqlite_schema WHERE type = 'view' AND name = ?").get(name);
    return (row as { sql: string } | undefined)?.sql ?? null;
  }

  recordedColumns(table: string): Set<string> {
    const rows = this.db.prepare("SELECT col FROM _yamlite_columns WHERE tbl = ?").all(table) as Array<{ col: string }>;
    return new Set(rows.map((r) => r.col));
  }

  recordColumns(table: string, columns: Iterable<string>): void {
    this.db.prepare("DELETE FROM _yamlite_columns WHERE tbl = ?").run(table);
    const insert = this.db.prepare("INSERT INTO _yamlite_columns (tbl, col) VALUES (?, ?)");
    for (const column of columns) insert.run(table, column);
  }

  close(): void {
    this.db.close();
  }

  // when the database files last changed: never earlier than the latest commit to any row
  lastWriteMs(): number | undefined {
    const times = [this.path, `${this.path}-wal`].map((p) => statSync(p, { throwIfNoEntry: false })?.mtimeMs ?? 0);
    const latest = Math.max(...times);
    return latest > 0 ? latest : undefined;
  }

  dataVersion(): number {
    const row = this.db.prepare("PRAGMA data_version").get() as { data_version: number };
    return Number(row.data_version);
  }

  begin(immediate = true): void {
    try {
      this.db.exec(immediate ? "BEGIN IMMEDIATE" : "BEGIN");
    } catch (e) {
      if (isBusy(e)) throw new BusyError("database is locked");
      throw e;
    }
  }

  commit(): void {
    this.db.exec("COMMIT");
  }

  rollback(): void {
    if (this.db.isTransaction) this.db.exec("ROLLBACK");
  }

  // runs fn so that a failure undoes only its own writes, not the whole transaction
  savepoint(fn: () => void): void {
    this.db.exec("SAVEPOINT yamlite_record");
    try {
      fn();
    } catch (e) {
      this.db.exec("ROLLBACK TO yamlite_record");
      throw e;
    } finally {
      this.db.exec("RELEASE yamlite_record");
    }
  }

  tableExists(table: string): boolean {
    return this.db.prepare("SELECT 1 FROM sqlite_schema WHERE type = 'table' AND name = ?").get(table) !== undefined;
  }

  managedIndexes(table: string): Set<string> {
    const rows = this.db
      .prepare("SELECT name FROM sqlite_schema WHERE type = 'index' AND tbl_name = ? AND name GLOB 'yamlite_*'")
      .all(table) as Array<{ name: string }>;
    return new Set(rows.map((r) => r.name));
  }

  exec(sql: string): void {
    this.db.exec(sql);
  }

  query(sql: string, ...params: DbValue[]): DbRow[] {
    const stmt = this.db.prepare(sql);
    stmt.setReadBigInts(true);
    return stmt.all(...params).map((row) => ({ ...row }) as DbRow);
  }

  run(sql: string, ...params: DbValue[]): void {
    this.db.prepare(sql).run(...params);
  }

  // one statement of any kind, for the SQL console
  execute(sql: string, limit: number): ExecResult {
    try {
      const stmt = this.db.prepare(sql);
      stmt.setReadBigInts(true);
      const columns = stmt.columns().map((c) => c.name);
      if (columns.length === 0) {
        const result = stmt.run();
        return { columns: null, rows: [], changes: Number(result.changes), truncated: false };
      }
      const rows: DbRow[] = [];
      let truncated = false;
      for (const row of stmt.iterate()) {
        if (rows.length === limit) {
          truncated = true;
          break;
        }
        rows.push({ ...row } as DbRow);
      }
      return { columns, rows, changes: 0, truncated };
    } catch (e) {
      if (isBusy(e)) throw new BusyError("database is locked");
      throw e;
    }
  }

  columns(table: string): Map<string, ColumnType> {
    const rows = this.db.prepare(`PRAGMA table_info(${q(table)})`).all() as Array<{ name: string; type: string }>;
    return new Map(rows.map((r) => [r.name, logicalType(r.type)]));
  }

  ensureTable(
    table: string,
    keyCol: string,
    columns: Map<string, ColumnType>,
    existing: Map<string, ColumnType> = this.columns(table),
  ): void {
    if (!this.tableExists(table)) {
      const defs = [`${q(keyCol)} ${columns.get(keyCol) ?? "TEXT"} PRIMARY KEY`];
      for (const [name, type] of columns) if (name !== keyCol) defs.push(`${q(name)} ${type}`);
      this.db.exec(`CREATE TABLE ${q(table)} (${defs.join(", ")})`);
      return;
    }
    for (const [name, type] of columns) {
      if (!existing.has(name)) this.db.exec(`ALTER TABLE ${q(table)} ADD COLUMN ${q(name)} ${type}`);
    }
  }

  readAll(table: string, keyCol: string): DbRead {
    const stmt = this.db.prepare(`SELECT * FROM ${q(table)}`);
    stmt.setReadBigInts(true);
    const out: DbRead = { rows: new Map(), skip: new Set(), nullKeys: 0 };
    for (const raw of stmt.all()) {
      const row = { ...raw } as DbRow;
      const value = row[keyCol];
      if (value === null || value === undefined) {
        out.nullKeys++;
        continue;
      }
      const key = String(value);
      if (out.rows.has(key)) out.skip.add(key);
      else out.rows.set(key, row);
    }
    return out;
  }

  readRow(table: string, keyCol: string, keyValue: DbValue): DbRow | undefined {
    const stmt = this.db.prepare(`SELECT * FROM ${q(table)} WHERE ${q(keyCol)} = ?`);
    stmt.setReadBigInts(true);
    const row = stmt.get(keyValue);
    return row ? ({ ...row } as DbRow) : undefined;
  }

  upsert(table: string, keyCol: string, row: DbRow, names: readonly string[]): void {
    const keyValue = row[keyCol] ?? null;
    const others = names.filter((name) => name !== keyCol);
    let changed = 0;
    if (others.length > 0) {
      const sets = others.map((name) => `${q(name)} = ?`).join(", ");
      const result = this.db
        .prepare(`UPDATE ${q(table)} SET ${sets} WHERE ${q(keyCol)} = ?`)
        .run(...others.map((name) => row[name] ?? null), keyValue);
      changed = Number(result.changes);
    } else if (this.readRow(table, keyCol, keyValue)) {
      changed = 1;
    }
    if (changed === 0) {
      const placeholders = names.map(() => "?").join(", ");
      this.db
        .prepare(`INSERT INTO ${q(table)} (${names.map(q).join(", ")}) VALUES (${placeholders})`)
        .run(...names.map((name) => row[name] ?? null));
    }
  }

  delete(table: string, keyCol: string, keyValue: DbValue): void {
    this.db.prepare(`DELETE FROM ${q(table)} WHERE ${q(keyCol)} = ?`).run(keyValue);
  }

  getState(table: string): Map<string, BaseHashes> {
    const rows = this.db
      .prepare("SELECT key, file_hash, db_hash FROM _yamlite_state WHERE tbl = ?")
      .all(table) as Array<{ key: string; file_hash: string | null; db_hash: string | null }>;
    return new Map(rows.map((r) => [r.key, { f: r.file_hash, d: r.db_hash }]));
  }

  setState(table: string, key: string, hashes: BaseHashes): void {
    this.db
      .prepare(
        "INSERT INTO _yamlite_state (tbl, key, file_hash, db_hash, synced_at) VALUES (?, ?, ?, ?, ?) ON CONFLICT (tbl, key) DO UPDATE SET file_hash = excluded.file_hash, db_hash = excluded.db_hash, synced_at = excluded.synced_at",
      )
      .run(table, key, hashes.f, hashes.d, Date.now());
  }

  dropState(table: string, key: string): void {
    this.db.prepare("DELETE FROM _yamlite_state WHERE tbl = ? AND key = ?").run(table, key);
  }
}
