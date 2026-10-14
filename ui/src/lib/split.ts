import type { Filter, Row, SplitItem, SplitMeta, TableMeta } from "./types";

export function splitFilter(split: SplitMeta, item: SplitItem): Filter {
  if (item.value === null) return { col: split.column, op: "null" };
  return { col: split.column, op: split.json ? "has" : "eq", value: item.value };
}

export function isSplitActive(filters: Filter[], split: SplitMeta, item: SplitItem): boolean {
  if (filters.length !== 1) return false;
  const [f] = filters;
  const want = splitFilter(split, item);
  return f!.col === want.col && f!.op === want.op && f!.value === want.value;
}

const isCapture = (table: TableMeta, col: string) => (table.captures ?? []).some((c) => c.column === col);

// a column, or a field path through a JSON column: "metadata.status" → ["metadata", "status"]
function pathOf(table: TableMeta, col: string): string[] | null {
  if (Object.hasOwn(table.columns, col)) return [col];
  const [head, ...rest] = col.split(".");
  if (!head || rest.length === 0 || rest.some((p) => p === "")) return null;
  return Object.hasOwn(table.columns, head) && table.columns[head] === "JSON" ? [head, ...rest] : null;
}

const isMap = (v: unknown): v is Row => v !== null && typeof v === "object" && !Array.isArray(v);

function put(row: Row, path: string[], value: unknown): Row {
  const [head, ...rest] = path as [string, ...string[]];
  if (rest.length === 0) return { ...row, [head]: value };
  return { ...row, [head]: put(isMap(row[head]) ? row[head] : {}, rest, value) };
}

// a new record opened from a filtered table starts with the values the filter picks
export function seedValues(table: TableMeta, filters: Filter[]): Row {
  let seed: Row = {};
  for (const f of filters) {
    if (f.col === table.key || isCapture(table, f.col)) continue;
    const path = pathOf(table, f.col);
    if (path === null) continue;
    if (f.op === "eq") seed = put(seed, path, f.value);
    // an item of a JSON column is a list of one; a field path may hold a single value
    else if (f.op === "has") seed = put(seed, path, path.length > 1 ? f.value : [f.value]);
  }
  return seed;
}

// a new record opened from a table filtered by its leading captures starts in their folders
export function seedKey(table: TableMeta, filters: Filter[]): string {
  const captures = [...(table.captures ?? [])].sort((a, b) => a.segment - b.segment);
  let key = "";
  for (const [i, c] of captures.entries()) {
    if (c.segment !== i) break;
    const f = filters.find((x) => x.col === c.column && x.op === "eq");
    if (!f) break;
    key += `${String(f.value)}/`;
  }
  return key;
}
