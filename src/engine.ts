import { mismatches, preferFileValues, recordToRow, rowToRecord } from "./codec.ts";
import { saveConflict } from "./conflicts.ts";
import { hashRecord } from "./hash.ts";
import { reconcileIndexes, type SchemaChange } from "./indexes.ts";
import { migrateSchema, type Schema } from "./migrate.ts";
import { planTable, type Registered, type TablePlan, undeclaredColumns } from "./plan.ts";
import type { Decision, KeyState } from "./reconcile.ts";
import { DirSource } from "./source/dir.ts";
import { ListSource } from "./source/list.ts";
import type { FileOp, Source, SourceRead } from "./source/types.ts";
import { BusyError, isConstraintError, type Store } from "./store.ts";
import type { ColumnType, TableSpec } from "./types.ts";
import { reconcileViews } from "./views.ts";

export type { Registered } from "./plan.ts";

export interface EngineContext {
  store: Store;
  stateDir: string;
  // called after a sync with columns that exist in the table but are not declared in yamlite.yaml yet
  register?: (table: string, columns: Record<string, ColumnType>) => void;
}

export interface SyncOptions {
  force?: boolean;
  forceConvert?: boolean;
  dryRun?: boolean;
  dbTime?: number;
}

export interface ConflictInfo {
  table: string;
  key: string;
  winner: "file" | "db";
  savedTo: string | null;
}

export type ChangeOp = "toDb" | "toFile" | "deleteDb" | "deleteFile";

export interface Change {
  key: string;
  op: ChangeOp;
}

export interface TableResult {
  table: string;
  records: number;
  changes: Change[];
  schema: SchemaChange[];
  registered: Registered[];
  ok: boolean;
  error?: string;
  busy?: boolean;
  toDb: number;
  toFile: number;
  deletedDb: number;
  deletedFile: number;
  conflicts: ConflictInfo[];
  warnings: string[];
  decisions?: Decision[];
}

export function makeSource(spec: TableSpec): Source {
  return spec.mode === "dir" ? new DirSource(spec.path, spec.key, spec.exclude) : new ListSource(spec.path, spec.key);
}

function emptyResult(table: string): TableResult {
  return {
    table,
    ok: true,
    records: 0,
    changes: [],
    schema: [],
    registered: [],
    toDb: 0,
    toFile: 0,
    deletedDb: 0,
    deletedFile: 0,
    conflicts: [],
    warnings: [],
  };
}

const errorMessage = (e: unknown) => (e instanceof Error ? e.message : String(e));

// the counts are derived from the changes so that a status and a sync report them the same way
function withCounts(res: TableResult): TableResult {
  const count = (op: ChangeOp) => res.changes.filter((c) => c.op === op).length;
  return {
    ...res,
    toDb: count("toDb"),
    toFile: count("toFile"),
    deletedDb: count("deleteDb"),
    deletedFile: count("deleteFile"),
  };
}

function finish(res: TableResult, present: number): TableResult {
  const counted = withCounts(res);
  return { ...counted, records: present - counted.deletedDb - counted.deletedFile };
}

function plannedOp(d: Decision, s: KeyState): ChangeOp | null {
  if (d.action === "toDb") return s.f === null ? "deleteDb" : "toDb";
  if (d.action === "toFile") return s.d === null ? "deleteFile" : "toFile";
  return null;
}

export function syncTable(ctx: EngineContext, spec: TableSpec, opts: SyncOptions = {}): TableResult {
  const res = emptyResult(spec.name);
  const { store } = ctx;
  const dryRun = opts.dryRun ?? false;
  try {
    store.begin(!dryRun);
  } catch (e) {
    if (e instanceof BusyError) return { ...res, ok: false, busy: true, error: e.message };
    return { ...res, ok: false, error: errorMessage(e) };
  }
  try {
    const source = makeSource(spec);
    const files = source.read();
    res.warnings.push(...files.warnings);
    const schema = migrateSchema(store, spec, files, {
      dryRun,
      forceConvert: opts.forceConvert ?? false,
      declarative: ctx.register !== undefined && spec.persisted,
    });
    res.schema.push(...schema.changes);
    res.warnings.push(...schema.warnings);
    const p = planTable(store, spec, files, schema, { force: opts.force ?? false, dryRun, dbTime: opts.dbTime });
    res.warnings.push(...p.warnings);
    if (!p.ok) throw new Error(p.error);

    if (dryRun) {
      res.registered = undeclaredColumns(spec, schema, p, p.createsColumns);
      const indexes = reconcileIndexes(store, spec.name, spec.indexes, new Set(p.types.keys()), false);
      res.schema.push(...indexes.changes);
      res.warnings.push(...indexes.warnings);
      const views = reconcileViews(store, spec, false);
      res.schema.push(...views.changes);
      res.warnings.push(...views.warnings);
      store.rollback();
      if (p.blocked) res.warnings.push(p.blocked);
      res.decisions = p.decisions;
      for (const d of p.decisions) {
        const s = p.states.get(d.key);
        if (!s) continue;
        const op = plannedOp(d, s);
        if (op) res.changes.push({ key: d.key, op });
        if (d.conflict) res.conflicts.push({ table: spec.name, key: d.key, winner: d.conflict, savedTo: null });
      }
      return finish(res, p.present);
    }
    if (p.blocked) throw new Error(p.blocked);

    const { fileOps, names } = applyToDb(ctx, spec, files, schema, p, res);
    if (store.tableExists(spec.name)) {
      const columns = new Set(names.length > 0 ? names : schema.existing.keys());
      const indexes = reconcileIndexes(store, spec.name, spec.indexes, columns, true);
      res.schema.push(...indexes.changes);
      res.warnings.push(...indexes.warnings);
    }
    const views = reconcileViews(store, spec, true);
    res.schema.push(...views.changes);
    res.warnings.push(...views.warnings);
    store.commit();

    applyToFiles(store, spec, source, files, p, fileOps, res);
    persistColumns(ctx, spec, schema, p, names, res);
    return finish(res, p.present);
  } catch (e) {
    store.rollback();
    return { ...withCounts(res), ok: false, error: errorMessage(e) };
  }
}

// Writes the decisions that go to the DB and returns the ones that go to files, which are written after the commit.
function applyToDb(
  ctx: EngineContext,
  spec: TableSpec,
  files: SourceRead,
  schema: Schema,
  p: TablePlan,
  res: TableResult,
): { fileOps: FileOp[]; names: string[] } {
  const { store } = ctx;
  let names: string[] = [];
  if (p.createsColumns) {
    store.ensureTable(spec.name, spec.key, p.types, schema.existing);
    names = [...p.types.keys()];
  }
  const fileOps: FileOp[] = [];
  for (const decision of p.decisions) {
    const { key } = decision;
    const s = p.states.get(key) as KeyState;
    const fileRecord = files.records.get(key) ?? null;
    const row = p.db.rows.get(key);
    const dbRecord = row ? rowToRecord(row, p.types, p.omit) : null;
    if (decision.conflict) {
      const loser = decision.conflict === "file" ? dbRecord : fileRecord;
      const savedTo = saveConflict(ctx.stateDir, spec.name, key, loser, decision.conflict);
      res.conflicts.push({ table: spec.name, key, winner: decision.conflict, savedTo });
    }
    if (decision.action === "toDb") {
      if (fileRecord === null) {
        if (row) store.delete(spec.name, spec.key, row[spec.key] ?? null);
        store.dropState(spec.name, key);
        res.changes.push({ key, op: "deleteDb" });
        continue;
      }
      for (const column of mismatches(fileRecord, p.types)) {
        res.warnings.push(`${key}: "${column}" does not match column type ${p.types.get(column)}; stored as is`);
      }
      const newRow = recordToRow(fileRecord);
      if (row) newRow[spec.key] = row[spec.key] ?? null;
      else {
        if (spec.mode === "dir") newRow[spec.key] = key;
        // column affinity can convert the key (e.g. "05" to 5) so that it hits another row
        const taken = store.readRow(spec.name, spec.key, newRow[spec.key] ?? null);
        if (taken) {
          res.warnings.push(`${key}: "${spec.key}" matches the existing row "${String(taken[spec.key])}"; skipped`);
          continue;
        }
      }
      try {
        store.savepoint(() => store.upsert(spec.name, spec.key, newRow, names));
      } catch (e) {
        if (!isConstraintError(e)) throw e;
        res.warnings.push(`${key}: ${e.message}; skipped`);
        continue;
      }
      const after = store.readRow(spec.name, spec.key, newRow[spec.key] ?? null);
      store.setState(spec.name, key, { f: s.f, d: after ? hashRecord(after) : null });
      res.changes.push({ key, op: "toDb" });
    } else if (decision.action === "toFile") {
      fileOps.push(
        dbRecord === null
          ? { kind: "delete", key }
          : { kind: "put", key, record: preferFileValues(dbRecord, fileRecord, p.types) },
      );
    } else if (decision.action === "base") {
      store.setState(spec.name, key, { f: s.f, d: s.d });
    } else if (decision.action === "drop") {
      store.dropState(spec.name, key);
    }
  }
  return { fileOps, names };
}

function applyToFiles(
  store: Store,
  spec: TableSpec,
  source: Source,
  files: SourceRead,
  p: TablePlan,
  fileOps: FileOp[],
  res: TableResult,
): void {
  const applied = source.apply(fileOps, files.stamps);
  for (const { key, reason } of applied.skipped) res.warnings.push(`${key}: ${reason}`);
  for (const [key, record] of applied.written) {
    if (record === null) {
      store.dropState(spec.name, key);
      res.changes.push({ key, op: "deleteFile" });
    } else {
      store.setState(spec.name, key, { f: hashRecord(record), d: p.states.get(key)?.d ?? null });
      res.changes.push({ key, op: "toFile" });
    }
  }
}

// adds new columns to yamlite.yaml and records what it declares, to tell a removed declaration apart later
function persistColumns(
  ctx: EngineContext,
  spec: TableSpec,
  schema: Schema,
  p: TablePlan,
  names: string[],
  res: TableResult,
): void {
  res.registered = undeclaredColumns(spec, schema, p, names.length > 0);
  if (!schema.declarative) return;
  if (ctx.register && res.registered.length > 0) {
    try {
      ctx.register(spec.name, Object.fromEntries(res.registered.map((r) => [r.column, r.type])));
    } catch (e) {
      res.registered = [];
      res.warnings.push(`could not add new columns to yamlite.yaml: ${errorMessage(e)}`);
    }
  }
  if (!ctx.store.tableExists(spec.name)) return;
  const registered = new Set(res.registered.map((r) => r.column));
  const final = new Set([...schema.existing.keys(), ...names]);
  ctx.store.recordColumns(
    spec.name,
    [...final].filter((c) => c !== spec.key && (c in spec.columns || registered.has(c) || schema.recorded.has(c))),
  );
}
