import { encode, recordToRow } from "../codec.ts";
import { invalidKey } from "../source/files.ts";
import type { Store } from "../store.ts";
import type { DbRow, Rec, TableSpec } from "../types.ts";
import { HttpError } from "./http.ts";
import { fromWire, toWire } from "./wire.ts";
import { ensureColumns, fromWireRecord } from "./write.ts";

// the record writes behind the UI's forms, shared with agent proposals; callers open the transaction

export function checkKey(spec: TableSpec, key: unknown): string {
  if (typeof key !== "string" || key === "") throw new HttpError(400, "key is required", { field: "key" });
  if (spec.mode === "files") {
    const reason = invalidKey(key);
    if (reason) throw new HttpError(400, reason, { field: "key" });
  }
  return key;
}

export function noKeyIn(spec: TableSpec, values: Record<string, unknown>, hint: string): void {
  if (spec.key in values) throw new HttpError(400, `"${spec.key}" is the key; ${hint}`, { field: spec.key });
}

export function readRecord(store: Store, spec: TableSpec, key: string): Rec | undefined {
  if (!store.tableExists(spec.name)) return undefined;
  const row = store.readRow(spec.name, spec.key, key);
  return row ? toWire(row, store.columns(spec.name)) : undefined;
}

export function insertRecord(store: Store, spec: TableSpec, key: string, values: Rec): void {
  checkKey(spec, key);
  noKeyIn(spec, values, 'send it as "key"');
  const before = store.tableExists(spec.name) ? store.columns(spec.name) : new Map();
  const record = fromWireRecord(values, before);
  const types = ensureColumns(store, spec, record);
  const keyValue = encode(fromWire(key, types.get(spec.key)));
  if (store.readRow(spec.name, spec.key, keyValue)) {
    throw new HttpError(409, `"${key}" already exists in ${spec.name}`, { field: "key" });
  }
  const row: DbRow = { ...recordToRow(record), [spec.key]: keyValue };
  store.upsert(spec.name, spec.key, row, Object.keys(row));
}

export function updateRecord(store: Store, spec: TableSpec, key: string, values: Rec): void {
  noKeyIn(spec, values, "rename the record instead");
  const row = store.tableExists(spec.name) ? store.readRow(spec.name, spec.key, key) : undefined;
  if (!row) throw new HttpError(404, `no record "${key}" in ${spec.name}`);
  const record = fromWireRecord(values, store.columns(spec.name));
  ensureColumns(store, spec, record);
  const update: DbRow = { ...recordToRow(record), [spec.key]: row[spec.key] ?? null };
  store.upsert(spec.name, spec.key, update, Object.keys(update));
}

export function deleteRecord(store: Store, spec: TableSpec, key: string): void {
  const row = store.tableExists(spec.name) ? store.readRow(spec.name, spec.key, key) : undefined;
  if (!row) throw new HttpError(404, `no record "${key}" in ${spec.name}`);
  store.delete(spec.name, spec.key, row[spec.key] ?? null);
}
