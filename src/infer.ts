import type { Rec } from "./types.ts";

// a list inside records that yamlite init declares under expand, with the items found in the data
export interface InferredExpand {
  field: string;
  items: Rec[];
  expand: InferredExpand[];
}

const isMap = (v: unknown): v is Rec => v !== null && typeof v === "object" && !Array.isArray(v);

// the items of a list of maps or a map of maps; null for anything else
function itemsOf(value: unknown): Rec[] | null {
  const items = Array.isArray(value) ? value : isMap(value) ? Object.values(value) : null;
  return items !== null && items.every(isMap) ? items : null;
}

// fields whose every value is a list of maps or a map of maps, at least one item in all; their items' fields are
// looked at the same way
export function inferExpand(records: Rec[], fields: (field: string) => boolean = () => true): InferredExpand[] {
  const names = [...new Set(records.flatMap((r) => Object.keys(r)))].filter(fields);
  const out: InferredExpand[] = [];
  for (const field of names) {
    const values = records.map((r) => r[field]).filter((v) => v !== null && v !== undefined);
    const lists = values.map(itemsOf);
    if (values.length === 0 || lists.some((l) => l === null)) continue;
    const items = (lists as Rec[][]).flat();
    if (items.length === 0) continue;
    out.push({ field, items, expand: inferExpand(items) });
  }
  return out;
}

export function expandToConfig(
  expanded: InferredExpand[],
  references: (e: InferredExpand) => Record<string, string> = () => ({}),
): Record<string, Record<string, unknown>> {
  return Object.fromEntries(
    expanded.map((e) => {
      const entry: Record<string, unknown> = {};
      const refs = references(e);
      if (Object.keys(refs).length > 0) entry.references = refs;
      if (e.expand.length > 0) entry.expand = expandToConfig(e.expand, references);
      return [e.field, entry];
    }),
  );
}

export interface KeyedTable {
  name: string;
  keys: Set<string>;
}

const isScalar = (v: unknown): v is string | number => typeof v === "string" || typeof v === "number";
const NUMERIC = /^-?\d+(\.\d+)?$/;

// the distinct values of a field whose values are all scalars or lists of scalars, as text; null otherwise
function scalarsOf(records: Rec[], field: string): Set<string> | null {
  const out = new Set<string>();
  for (const r of records) {
    const v = r[field];
    if (v === null || v === undefined) continue;
    const items = Array.isArray(v) ? v : [v];
    if (!items.every(isScalar)) return null;
    for (const i of items) out.add(String(i));
  }
  return out;
}

const namesTable = (field: string, table: string) =>
  [field, `${field}s`, `${field}es`, field.replace(/y$/, "ies")].includes(table);

// A field references a table it is named after (team → teams) when every value is one of its keys, or, named after
// none, the one table whose keys hold every value, given two values or more that are not all numbers. A value
// missing from the table fails `yamlite check`, so a generated config only declares references the data already
// meets. A field that only repeats each
// record's own key (ownKeys, in the order of records), such as a slug equal to the file name, is not a reference.
export function inferReferences(records: Rec[], tables: KeyedTable[], ownKeys?: string[]): Record<string, string> {
  const out: Record<string, string> = {};
  const mirrors = (field: string) =>
    ownKeys !== undefined &&
    records.every((r, i) => r[field] === null || r[field] === undefined || String(r[field]) === ownKeys[i]);
  for (const field of new Set(records.flatMap((r) => Object.keys(r)))) {
    if (mirrors(field)) continue;
    const values = scalarsOf(records, field);
    if (values === null || values.size === 0) continue;
    const holds = (t: KeyedTable) => [...values].every((v) => t.keys.has(v));
    const named = tables.find((t) => namesTable(field, t.name));
    if (named) {
      if (holds(named)) out[field] = named.name;
      continue;
    }
    if (values.size < 2 || [...values].every((v) => NUMERIC.test(v))) continue;
    const holding = tables.filter(holds);
    if (holding.length === 1) out[field] = (holding[0] as KeyedTable).name;
  }
  return out;
}
