import { canonical } from "./hash.ts";
import { matchesType } from "./schema.ts";
import type { ColumnType, DbRow, DbValue, Rec } from "./types.ts";

function toSafe(value: bigint): number | bigint {
  const n = Number(value);
  return Number.isSafeInteger(n) ? n : value;
}

const jsonReplacer = (_key: string, value: unknown) => {
  if (typeof value !== "bigint") return value;
  const safe = toSafe(value);
  return typeof safe === "bigint" ? safe.toString() : safe;
};

export function encode(value: unknown): DbValue {
  if (value === null || value === undefined) return null;
  if (typeof value === "boolean") return value ? 1n : 0n;
  if (typeof value === "bigint" || typeof value === "number" || typeof value === "string") return value;
  if (value instanceof Uint8Array) return value;
  return JSON.stringify(value, jsonReplacer);
}

export function decode(value: DbValue, type: ColumnType): unknown {
  if (value === null) return null;
  if (value instanceof Uint8Array) return Buffer.from(value).toString("base64");
  const v = typeof value === "bigint" ? toSafe(value) : value;
  if (type === "BOOLEAN" && (v === 0 || v === 1)) return v === 1;
  if (type === "JSON" && typeof v === "string") {
    try {
      const parsed: unknown = JSON.parse(v);
      if (parsed !== null && typeof parsed === "object") return parsed;
    } catch {
      // not JSON: keep the string
    }
  }
  return v;
}

export function recordToRow(record: Rec): DbRow {
  const row: DbRow = {};
  for (const [key, value] of Object.entries(record)) row[key] = encode(value);
  return row;
}

export function rowToRecord(row: DbRow, types: Map<string, ColumnType>, omit?: string): Rec {
  const out: Rec = {};
  for (const [key, value] of Object.entries(row)) {
    if (key === omit || value === null) continue;
    out[key] = decode(value, types.get(key) ?? "TEXT");
  }
  return out;
}

export function sameValue(fileValue: unknown, dbValue: unknown, type: ColumnType): boolean {
  const encoded = encode(fileValue);
  if (canonical(decode(encoded, type)) === canonical(dbValue ?? null)) return true;
  // TEXT affinity stores numbers as their text form
  if (type !== "TEXT" || typeof dbValue !== "string") return false;
  if (typeof encoded === "bigint") return dbValue === encoded.toString();
  return typeof encoded === "number" && sqliteRealText(dbValue) === String(encoded);
}

// SQLite renders REAL as text like "1.0" and "1.0e+21"; JS renders them as "1" and "1e+21"
const sqliteRealText = (text: string): string => text.replace(/\.0(?=e|$)/, "").replace(/e([+-])0+(?=\d)/, "e$1");

export function crossEqual(fileRecord: Rec, dbRecord: Rec, types: Map<string, ColumnType>): boolean {
  const keys = new Set([...Object.keys(fileRecord), ...Object.keys(dbRecord)]);
  for (const key of keys) {
    if (!sameValue(fileRecord[key], dbRecord[key], types.get(key) ?? "TEXT")) return false;
  }
  return true;
}

export function preferFileValues(dbRecord: Rec, fileRecord: Rec | null, types: Map<string, ColumnType>): Rec {
  if (fileRecord === null) return dbRecord;
  const out: Rec = {};
  for (const [field, value] of Object.entries(dbRecord)) {
    const keep = field in fileRecord && sameValue(fileRecord[field], value, types.get(field) ?? "TEXT");
    out[field] = keep ? fileRecord[field] : value;
  }
  return out;
}

export function mismatches(record: Rec, types: Map<string, ColumnType>): string[] {
  return Object.keys(record).filter((key) => {
    const type = types.get(key);
    return type !== undefined && !matchesType(record[key], type);
  });
}
