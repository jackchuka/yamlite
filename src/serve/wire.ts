import { decode } from "../codec.ts";
import type { ColumnType, DbRow, Rec } from "../types.ts";

// JSON.parse in the browser would round big integers, so they travel as decimal strings
export function wireValue(value: unknown): unknown {
  if (typeof value === "bigint") {
    const n = Number(value);
    return Number.isSafeInteger(n) ? n : value.toString();
  }
  if (Array.isArray(value)) return value.map(wireValue);
  if (value !== null && typeof value === "object") {
    return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, wireValue(v)]));
  }
  return value;
}

export function toWire(row: DbRow, types: Map<string, ColumnType>): Rec {
  const out: Rec = {};
  for (const [column, value] of Object.entries(row)) {
    out[column] = value === null ? null : wireValue(decode(value, types.get(column) ?? "TEXT"));
  }
  return out;
}

// integers become bigint like YAML values parsed with intAsBigInt, so inference and encoding match the engine
export function fromWire(value: unknown, type: ColumnType | undefined): unknown {
  if (value === null || value === undefined) return null;
  if (typeof value === "number" && Number.isInteger(value) && (type === "INTEGER" || type === undefined)) {
    return BigInt(value);
  }
  if (type === "INTEGER" && typeof value === "string" && /^-?\d+$/.test(value)) return BigInt(value);
  return value;
}
