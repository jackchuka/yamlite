import { readFileSync } from "node:fs";
import { type Document, isMap, parseDocument, type YAMLMap } from "yaml";
import { writeAtomic } from "./fsutil.ts";
import { STRINGIFY_OPTIONS } from "./source/yamldoc.ts";
import type { ColumnType } from "./types.ts";

export interface Registration {
  table: string;
  columns?: Record<string, ColumnType>;
}

// an empty flow map (`{}`) would keep everything added to it on one line
function blockMap(doc: Document, parent: YAMLMap, key: string): YAMLMap {
  const current = parent.get(key, true);
  if (isMap(current)) {
    if (current.flow && current.items.length === 0) current.flow = false;
    return current;
  }
  const created = doc.createNode({}) as YAMLMap;
  parent.set(key, created);
  return created;
}

// Appends tables and columns to yamlite.yaml without touching anything already there (values, comments, order).
// Returns whether the file changed.
export function registerInConfig(path: string, registrations: Registration[]): boolean {
  const text = readFileSync(path, "utf8");
  const doc = parseDocument(text);
  if (doc.errors.length > 0) throw new Error(`invalid ${path}: ${doc.errors[0]?.message.split("\n")[0]}`);
  if (!isMap(doc.contents)) doc.contents = doc.createNode({}) as unknown as typeof doc.contents;
  const root = doc.contents as unknown as YAMLMap;
  const tables = blockMap(doc, root, "tables");
  let changed = false;
  for (const { table, columns = {} } of registrations) {
    if (!tables.has(table)) changed = true;
    const entry = blockMap(doc, tables, table);
    const additions = Object.entries(columns);
    if (additions.length === 0) continue;
    const declared = blockMap(doc, entry, "columns");
    for (const [column, type] of additions) {
      if (declared.has(column)) continue;
      declared.set(column, type);
      changed = true;
    }
  }
  // keep the file's own flow style: `{ a: 1 }` stays padded, `{a: 1}` stays compact
  const padded = /[[{] [^\s\]}]/.test(text);
  if (changed) writeAtomic(path, doc.toString({ ...STRINGIFY_OPTIONS, flowCollectionPadding: padded }));
  return changed;
}
