import { canonical } from "./hash.ts";
import { matchesType } from "./schema.ts";
import { type ColumnType, type DbRow, own, type Rec } from "./types.ts";
import { decode, encode } from "./value.ts";

export { decode, encode };

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
    if (!sameValue(own(fileRecord, key), own(dbRecord, key), types.get(key) ?? "TEXT")) return false;
  }
  return true;
}

export function preferFileValues(dbRecord: Rec, fileRecord: Rec | null, types: Map<string, ColumnType>): Rec {
  if (fileRecord === null) return dbRecord;
  const out: Rec = {};
  for (const [field, value] of Object.entries(dbRecord)) {
    const keep = Object.hasOwn(fileRecord, field) && sameValue(fileRecord[field], value, types.get(field) ?? "TEXT");
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
