import { sample } from "./text.ts";
import type { ColumnType, Rec } from "./types.ts";

export function inferType(value: unknown): ColumnType | null {
  if (value === null || value === undefined) return null;
  switch (typeof value) {
    case "boolean":
      return "BOOLEAN";
    case "bigint":
      return "INTEGER";
    case "number":
      return "REAL";
    case "object":
      return "JSON";
    default:
      return "TEXT";
  }
}

export function mergeType(a: ColumnType | null, b: ColumnType | null): ColumnType | null {
  if (a === null) return b;
  if (b === null || a === b) return a;
  const numeric = (t: ColumnType) => t === "INTEGER" || t === "REAL";
  return numeric(a) && numeric(b) ? "REAL" : "TEXT";
}

export function inferColumns(records: Iterable<Rec>): Map<string, ColumnType> {
  const acc = new Map<string, ColumnType | null>();
  for (const record of records) {
    for (const [key, value] of Object.entries(record)) {
      acc.set(key, mergeType(acc.get(key) ?? null, inferType(value)));
    }
  }
  return new Map([...acc].map(([key, type]) => [key, type ?? "TEXT"]));
}

export function logicalType(declared: string): ColumnType {
  const d = declared.toUpperCase();
  if (d.includes("BOOL")) return "BOOLEAN";
  if (d.includes("JSON")) return "JSON";
  if (d.includes("INT")) return "INTEGER";
  if (d.includes("REAL") || d.includes("FLOA") || d.includes("DOUB")) return "REAL";
  return "TEXT";
}

export function isStructured(value: unknown): boolean {
  return value !== null && typeof value === "object" && !(value instanceof Uint8Array);
}

export interface ShapeCheck {
  error: string | null;
  skip: Map<string, string>;
}

// A column holds either scalars or structures (maps/lists), never both: JSON columns are structured, others scalar.
export function checkShapes(
  records: Map<string, Rec>,
  existing: Map<string, ColumnType>,
  overrides: Record<string, ColumnType>,
): ShapeCheck {
  const skip = new Map<string, string>();
  const byField = new Map<string, { scalar: string[]; structured: string[] }>();
  for (const [key, record] of records) {
    for (const [field, value] of Object.entries(record)) {
      if (value === null || value === undefined) continue;
      const declared = existing.get(field) ?? overrides[field];
      const structured = isStructured(value);
      if (declared !== undefined) {
        if (structured !== (declared === "JSON")) {
          const want = declared === "JSON" ? "a map or list" : "a scalar";
          skip.set(
            key,
            `"${field}" must be ${want} (column type ${declared}); this file is not synced; change it to ${want}, remove it, or change columns.${field} in yamlite.yaml`,
          );
        }
        continue;
      }
      const seen = byField.get(field) ?? { scalar: [], structured: [] };
      (structured ? seen.structured : seen.scalar).push(key);
      byField.set(field, seen);
    }
  }
  const mixed = [...byField].filter(([, s]) => s.scalar.length > 0 && s.structured.length > 0);
  const error =
    mixed.length === 0
      ? null
      : mixed
          .map(
            ([field, s]) =>
              `"${field}" mixes scalar and map/list values (scalar: ${sample(s.scalar)}; map/list: ${sample(s.structured)}); make them consistent or set columns.${field} in yamlite.yaml`,
          )
          .join("\n");
  return { error, skip };
}

export function matchesType(value: unknown, type: ColumnType): boolean {
  const inferred = inferType(value);
  if (inferred === null) return true;
  if (type === "REAL") return inferred === "REAL" || inferred === "INTEGER";
  return inferred === type;
}
