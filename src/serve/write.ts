import type { TableResult } from "../engine.ts";
import { inferType } from "../schema.ts";
import type { Store } from "../store.ts";
import type { ColumnType, Rec, TableSpec } from "../types.ts";
import { HttpError } from "./http.ts";
import { fromWire } from "./wire.ts";

export function writeTx<T>(store: Store, fn: () => T): T {
  store.begin();
  try {
    const out = fn();
    store.commit();
    return out;
  } catch (e) {
    store.rollback();
    throw e;
  }
}

export function objectBody(value: unknown, what: string): Record<string, unknown> {
  if (value === undefined) return {};
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new HttpError(400, `${what} must be an object`);
  }
  return value as Record<string, unknown>;
}

export function fromWireRecord(values: Record<string, unknown>, types: Map<string, ColumnType>): Rec {
  return Object.fromEntries(Object.entries(values).map(([k, v]) => [k, fromWire(v, types.get(k))]));
}

// declared types first, then the same inference the engine uses for YAML values
export function ensureColumns(store: Store, spec: TableSpec, record: Rec): Map<string, ColumnType> {
  const existing = store.tableExists(spec.name) ? store.columns(spec.name) : new Map<string, ColumnType>();
  const wanted = new Map<string, ColumnType>();
  if (existing.size === 0) wanted.set(spec.key, spec.columns[spec.key] ?? "TEXT");
  for (const [column, value] of Object.entries(record)) {
    if (existing.has(column) || wanted.has(column) || value === null) continue;
    wanted.set(column, spec.columns[column] ?? inferType(value) ?? "TEXT");
  }
  if (wanted.size > 0) store.ensureTable(spec.name, spec.key, wanted, existing);
  return store.columns(spec.name);
}

export function assertSynced(results: TableResult[], prefix: string, suffix = ""): void {
  const failed = results.filter((r) => !r.ok);
  if (failed.length > 0)
    throw new Error(`${prefix}: ${failed.map((r) => `${r.table} (${r.error})`).join("; ")}${suffix}`);
}
