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

// a new record opened from a filtered table starts with the values the filter picks
export function seedValues(table: TableMeta, filters: Filter[]): Row {
  const seed: Row = {};
  for (const f of filters) {
    if (f.col === table.key || !Object.hasOwn(table.columns, f.col)) continue;
    if (f.op === "eq") seed[f.col] = f.value;
    else if (f.op === "has") seed[f.col] = [f.value];
  }
  return seed;
}
