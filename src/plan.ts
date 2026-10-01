import { crossEqual, decode, rowToRecord } from "./codec.ts";
import { hashRecord } from "./hash.ts";
import type { Schema } from "./migrate.ts";
import { type Decision, type KeyState, plan } from "./reconcile.ts";
import { checkShapes, inferColumns, isStructured } from "./schema.ts";
import type { SourceRead } from "./source/types.ts";
import type { DbRead, Store } from "./store.ts";
import type { ColumnType, Rec, TableSpec } from "./types.ts";

export interface Registered {
  column: string;
  type: ColumnType;
}

export interface TablePlan {
  db: DbRead;
  // column types after the sync
  types: Map<string, ColumnType>;
  // the field left out of records (dir mode keeps the key in the file name)
  omit: string | undefined;
  states: Map<string, KeyState>;
  decisions: Decision[];
  blocked: string | null;
  // records on either side before the sync
  present: number;
  // whether the sync adds the table or columns to it
  createsColumns: boolean;
  warnings: string[];
}

// a table that cannot be planned still reports the warnings found before the error
export type PlanResult = ({ ok: true } & TablePlan) | { ok: false; error: string; warnings: string[] };

function planColumns(
  spec: TableSpec,
  existing: Map<string, ColumnType>,
  records: Iterable<Rec>,
): Map<string, ColumnType> {
  const types = new Map(existing);
  const inferred = inferColumns(records);
  if (!types.has(spec.key)) {
    types.set(spec.key, spec.mode === "dir" ? "TEXT" : (spec.columns[spec.key] ?? inferred.get(spec.key) ?? "TEXT"));
  }
  for (const [column, type] of inferred) if (!types.has(column)) types.set(column, spec.columns[column] ?? type);
  // declared columns exist even before any record uses them
  for (const [column, type] of Object.entries(spec.columns)) {
    if (!types.has(column) && !(spec.mode === "dir" && column === spec.key)) types.set(column, type);
  }
  return types;
}

// rows whose JSON columns hold something other than a map or list: the file must not receive them, but changes from
// the file still flow to the DB and repair them
function unwritable(db: DbRead, schema: Schema, dryRun: boolean): Map<string, string> {
  const out = new Map<string, string>();
  for (const [key, row] of db.rows) {
    for (const [field, type] of schema.existing) {
      const value = row[field];
      if (type !== "JSON" || value === null || value === undefined) continue;
      if (dryRun && schema.alterations.some((a) => a.column === field)) continue; // a rebuild will convert it
      if (!isStructured(decode(value, "JSON"))) {
        out.set(
          key,
          `"${field}" in the table is not a JSON map or list; not written to the file; set it to NULL or a JSON object/array, or edit the file`,
        );
      }
    }
  }
  return out;
}

// Decides what happens to every key without writing anything.
export function planTable(
  store: Store,
  spec: TableSpec,
  files: SourceRead,
  schema: Schema,
  opts: { force: boolean; dryRun: boolean; dbTime?: number },
): PlanResult {
  const { existing } = schema;
  const warnings: string[] = [];
  const db: DbRead = schema.tableExists
    ? store.readAll(spec.name, spec.key)
    : { rows: new Map(), skip: new Set(), nullKeys: 0 };
  if (db.nullKeys > 0) warnings.push(`${db.nullKeys} rows with NULL "${spec.key}" are ignored`);
  for (const key of db.skip) warnings.push(`duplicate "${spec.key}" = "${key}" in the table; skipped`);
  const shapes = checkShapes(files.records, existing, spec.columns);
  if (shapes.error) return { ok: false, error: shapes.error, warnings };
  const noWriteBack = unwritable(db, schema, opts.dryRun);
  for (const [key, reason] of [...shapes.skip, ...noWriteBack]) warnings.push(`${key}: ${reason}`);
  const accepted = [...files.records].filter(([key]) => !shapes.skip.has(key)).map(([, record]) => record);
  const types = planColumns(spec, existing, accepted);
  const omit = spec.mode === "dir" ? spec.key : undefined;

  const states = new Map<string, KeyState>();
  for (const key of new Set([...files.records.keys(), ...files.skip, ...db.rows.keys(), ...schema.base.keys()])) {
    const fileRecord = files.records.get(key);
    const row = db.rows.get(key);
    states.set(key, {
      key,
      f: fileRecord ? hashRecord(fileRecord) : null,
      d: row ? hashRecord(row) : null,
      base: schema.base.get(key) ?? null,
      skip: files.skip.has(key) || db.skip.has(key) || shapes.skip.has(key),
      equal:
        fileRecord !== undefined && row !== undefined && crossEqual(fileRecord, rowToRecord(row, types, omit), types),
      fTime: files.mtimes.get(key),
      dTime: opts.dbTime,
    });
  }
  const p = plan([...states.values()], { force: opts.force });
  const decisions = p.decisions.map((d): Decision => {
    if (!noWriteBack.has(d.key) || d.action !== "toFile") return d;
    return d.conflict === "db" ? { key: d.key, action: "toDb", conflict: "file" } : { key: d.key, action: "none" };
  });
  const present = new Set([...files.records.keys(), ...files.skip, ...db.rows.keys()]).size;
  const declaredMissing = schema.tableExists && [...types.keys()].some((c) => !existing.has(c));
  const createsColumns = declaredMissing || decisions.some((d) => d.action === "toDb" && states.get(d.key)?.f !== null);
  return { ok: true, db, types, omit, states, decisions, blocked: p.blocked, present, createsColumns, warnings };
}

// columns of the table that yamlite.yaml does not declare yet
export function undeclaredColumns(spec: TableSpec, schema: Schema, p: TablePlan, created: boolean): Registered[] {
  return [...p.types]
    .filter(([column]) => !(column in spec.columns) && !schema.recorded.has(column))
    .filter(([column]) => !(spec.mode === "dir" && column === spec.key))
    .filter(([column]) => created || schema.existing.has(column))
    .map(([column, type]) => ({ column, type }));
}
