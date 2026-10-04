import type { ColumnType, DbValue } from "./types.ts";

function toSafe(value: bigint): number | bigint {
  const n = Number(value);
  return Number.isSafeInteger(n) ? n : value;
}

const jsonReplacer = (_key: string, value: unknown) => {
  if (typeof value !== "bigint") return value;
  const safe = toSafe(value);
  return typeof safe === "bigint" ? safe.toString() : safe;
};

function base64(bytes: Uint8Array): string {
  let text = "";
  for (const b of bytes) text += String.fromCharCode(b);
  return btoa(text);
}

export function encode(value: unknown): DbValue {
  if (value === null || value === undefined) return null;
  if (typeof value === "boolean") return value ? 1n : 0n;
  if (typeof value === "bigint" || typeof value === "number" || typeof value === "string") return value;
  if (value instanceof Uint8Array) return value;
  return JSON.stringify(value, jsonReplacer);
}

export function decode(value: DbValue, type: ColumnType): unknown {
  if (value === null) return null;
  if (value instanceof Uint8Array) return base64(value);
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
