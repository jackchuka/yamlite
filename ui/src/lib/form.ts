import { isScalar } from "./cell";
import type { ColumnFormat, ColumnType, Row } from "./types";

export type FieldKind =
  | "switch"
  | "number"
  | "bigint"
  | "text"
  | "textarea"
  | "markdown"
  | "ref"
  | "map"
  | "chips"
  | "json"
  | "unset";

const isMap = (v: unknown): v is Record<string, unknown> => v !== null && typeof v === "object" && !Array.isArray(v);
const isChips = (v: unknown): v is string[] => Array.isArray(v) && v.every((x) => typeof x === "string");

// what the form can edit field by field; anything else falls back to a JSON editor for that field
function representable(v: unknown): boolean {
  if (isScalar(v)) return true;
  if (Array.isArray(v)) return isChips(v);
  return isMap(v) && Object.values(v).every(representable);
}

export function fieldKind(
  value: unknown,
  type: ColumnType | undefined,
  isRef: boolean,
  format?: ColumnFormat,
): FieldKind {
  if (isRef) return "ref";
  if (value === null || value === undefined) return "unset";
  if (typeof value === "boolean") return "switch";
  if (typeof value === "number") return "number";
  if (typeof value === "string") {
    if (type === "INTEGER" && /^-?\d+$/.test(value)) return "bigint";
    if (format === "markdown") return "markdown";
    return value.includes("\n") || value.length > 80 ? "textarea" : "text";
  }
  if (isChips(value)) return "chips";
  if (isMap(value) && representable(value)) return "map";
  return "json";
}

export function emptyValueFor(type: ColumnType): unknown {
  switch (type) {
    case "BOOLEAN":
      return false;
    case "INTEGER":
    case "REAL":
      return 0;
    case "JSON":
      return {};
    case "TEXT":
      return "";
  }
}

// key order does not count as a change: the engine compares values, not text
function stable(v: unknown): string {
  return JSON.stringify(v ?? null, (_k, x: unknown) =>
    isMap(x)
      ? Object.fromEntries(
          Object.keys(x)
            .sort()
            .map((k) => [k, x[k]]),
        )
      : x,
  );
}

export function changedFields(base: Row, draft: Row): string[] {
  const keys = new Set([...Object.keys(base), ...Object.keys(draft)]);
  return [...keys].filter((k) => stable(base[k]) !== stable(draft[k]));
}

export function buildPatch(base: Row, draft: Row): { values: Row; base: Row } {
  const fields = changedFields(base, draft);
  return {
    values: Object.fromEntries(fields.map((f) => [f, draft[f] ?? null])),
    base: Object.fromEntries(fields.map((f) => [f, base[f] ?? null])),
  };
}

export function setIn(value: unknown, path: Array<string | number>, next: unknown): unknown {
  if (path.length === 0) return next;
  const [head, ...rest] = path as [string | number, ...Array<string | number>];
  if (Array.isArray(value)) {
    const copy = [...value];
    copy[head as number] = setIn(copy[head as number], rest, next);
    return copy;
  }
  const obj = isMap(value) ? value : {};
  return { ...obj, [head]: setIn(obj[head as string], rest, next) };
}

export function removeIn(value: unknown, path: Array<string | number>): unknown {
  if (path.length === 0) return undefined;
  const [head, ...rest] = path as [string | number, ...Array<string | number>];
  if (rest.length > 0) {
    if (Array.isArray(value)) return value.map((v, i) => (i === head ? removeIn(v, rest) : v));
    if (isMap(value)) return { ...value, [head]: removeIn(value[head as string], rest) };
    return value;
  }
  if (Array.isArray(value)) return value.filter((_, i) => i !== head);
  if (isMap(value)) {
    const { [head as string]: _gone, ...others } = value;
    return others;
  }
  return value;
}
