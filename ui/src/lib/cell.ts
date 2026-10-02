import type { ColumnType } from "./types";

export type CellView =
  | { kind: "null" }
  | { kind: "bool"; value: boolean }
  | { kind: "number"; text: string }
  | { kind: "text"; text: string }
  | { kind: "chips"; items: string[]; more: number }
  | { kind: "map"; entries: Array<[string, string]>; more: number }
  | { kind: "nested"; label: string; preview: string };

export const isScalar = (v: unknown): boolean =>
  v === null || typeof v === "string" || typeof v === "number" || typeof v === "boolean";

const isMap = (v: unknown): v is Record<string, unknown> => v !== null && typeof v === "object" && !Array.isArray(v);
const sizeLabel = (v: unknown): string =>
  Array.isArray(v) ? `[${v.length}]` : isMap(v) ? `{${Object.keys(v).length}}` : "";

const CHIPS = 3;
const MAP_ENTRIES = 2;

export function cellView(value: unknown, type: ColumnType): CellView {
  if (value === null || value === undefined) return { kind: "null" };
  if (typeof value === "boolean") return { kind: "bool", value };
  if (typeof value === "number") return { kind: "number", text: String(value) };
  if (typeof value === "string") {
    if (type === "INTEGER" && /^-?\d+$/.test(value)) return { kind: "number", text: value };
    return { kind: "text", text: value.replaceAll("\n", " ⏎ ") };
  }
  if (Array.isArray(value)) {
    if (value.every(isScalar)) {
      return { kind: "chips", items: value.slice(0, CHIPS).map(String), more: Math.max(0, value.length - CHIPS) };
    }
    return { kind: "nested", label: sizeLabel(value), preview: value.map(sizeLabel).join(", ") };
  }
  if (isMap(value)) {
    const entries = Object.entries(value);
    if (entries.length > 0 && entries.every(([, v]) => isScalar(v))) {
      return {
        kind: "map",
        entries: entries.slice(0, MAP_ENTRIES).map(([k, v]) => [k, String(v)]),
        more: Math.max(0, entries.length - MAP_ENTRIES),
      };
    }
    return {
      kind: "nested",
      label: sizeLabel(value),
      preview: entries.map(([k, v]) => (isScalar(v) ? k : `${k}${sizeLabel(v)}`)).join(", "),
    };
  }
  return { kind: "text", text: String(value) };
}
