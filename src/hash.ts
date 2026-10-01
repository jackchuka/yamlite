import { createHash } from "node:crypto";

function normalize(value: unknown): unknown {
  if (value === null || value === undefined) return null;
  if (typeof value === "bigint") {
    const n = Number(value);
    return Number.isSafeInteger(n) ? n : { $big: value.toString() };
  }
  if (value instanceof Uint8Array) return { $bytes: Buffer.from(value).toString("base64") };
  if (Array.isArray(value)) return value.map(normalize);
  if (typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const key of Object.keys(value).sort()) {
      const v = (value as Record<string, unknown>)[key];
      if (v !== null && v !== undefined) out[key] = normalize(v);
    }
    return out;
  }
  return value;
}

export function canonical(value: unknown): string {
  return JSON.stringify(normalize(value));
}

export function hashRecord(record: Record<string, unknown>): string {
  return createHash("sha256").update(canonical(record)).digest("hex");
}

export function hashContent(content: string | Uint8Array): string {
  return createHash("sha256").update(content).digest("hex");
}
