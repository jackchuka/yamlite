import { readFileSync } from "node:fs";
import {
  type Document,
  isMap,
  isNode,
  isScalar,
  isSeq,
  type Node,
  parseDocument,
  type YAMLMap,
  type YAMLSeq,
} from "yaml";
import { toIndex } from "./config.ts";
import { writeAtomic } from "./fsutil.ts";
import { canonical, hashContent } from "./hash.ts";
import { stringifyOptions } from "./source/yamldoc.ts";
import type { AllowedValue, Bound, ColumnFormat, ColumnType, IndexSpec } from "./types.ts";

export interface Registration {
  table: string;
  columns?: Record<string, ColumnType>;
  // written only when the table is new
  path?: string;
  files?: string;
  key?: string;
  group?: string;
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
  for (const { table, columns = {}, path: tablePath, files, key, group } of registrations) {
    const isNew = !tables.has(table);
    if (isNew) changed = true;
    const entry = blockMap(doc, tables, table);
    if (isNew && tablePath !== undefined) entry.set("path", tablePath);
    if (isNew && files !== undefined) entry.set("files", files);
    if (isNew && key !== undefined) entry.set("key", key);
    if (isNew && group !== undefined) entry.set("group", group);
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
  if (changed) writeAtomic(path, doc.toString({ ...stringifyOptions(text), flowCollectionPadding: padded }));
  return changed;
}

// Sets or (with null) removes a table's group in yamlite.yaml, keeping everything else. Returns whether the file changed.
export function setTableGroup(path: string, table: string, group: string | null): boolean {
  const text = readFileSync(path, "utf8");
  const doc = parseDocument(text);
  if (doc.errors.length > 0) throw new Error(`invalid ${path}: ${doc.errors[0]?.message.split("\n")[0]}`);
  if (!isMap(doc.contents)) doc.contents = doc.createNode({}) as unknown as typeof doc.contents;
  const tables = blockMap(doc, doc.contents as unknown as YAMLMap, "tables");
  const current = tables.get(table, true);
  const listed = isMap(current) ? current : null;
  if ((listed?.get("group") ?? null) === group) return false;
  if (group === null) listed?.delete("group");
  else blockMap(doc, tables, table).set("group", group);
  const padded = /[[{] [^\s\]}]/.test(text);
  writeAtomic(path, doc.toString({ ...stringifyOptions(text), flowCollectionPadding: padded }));
  return true;
}

export interface RuleTarget {
  table: string;
  // the fields from the table's record down to the expanded view; [] for the table
  path: string[];
}

export interface Rules {
  required: string[];
  values: Record<string, AllowedValue[]>;
  formats: Record<string, ColumnFormat>;
  min: Record<string, Bound>;
  max: Record<string, Bound>;
  // column → "table" or "table.column", as written in yamlite.yaml
  references: Record<string, string>;
}

export const RULE_KEYS: readonly (keyof Rules)[] = ["required", "values", "min", "max", "formats", "references"];

export const configHash = (text: string): string => hashContent(text);

const same = (node: unknown, value: unknown): boolean =>
  canonical(isNode(node) ? node.toJSON() : node) === canonical(value);

// a new list is written in flow style unless it replaces a block-style one
function listNode(doc: Document, value: unknown, current: unknown): Node {
  const node = doc.createNode(value) as Node;
  if (isSeq(node)) node.flow = isSeq(current) ? current.flow === true : true;
  return node;
}

const keyText = (key: unknown): string => (isScalar(key) ? String(key.value) : String(key));

function ruleTarget(doc: Document, target: RuleTarget): YAMLMap {
  const root = doc.contents;
  const tables = isMap(root) ? root.get("tables", true) : undefined;
  if (!isMap(tables) || !tables.has(target.table)) throw new Error(`unknown table: ${target.table}`);
  let entry = blockMap(doc, tables, target.table);
  let name = target.table;
  for (const field of target.path) {
    name = `${name}__${field}`;
    const expand = entry.get("expand", true);
    if (!isMap(expand) || !expand.has(field)) throw new Error(`unknown view: ${name}`);
    entry = blockMap(doc, expand, field);
  }
  return entry;
}

export type IndexEdit = { columns: string[]; unique: boolean } | { expr: string; unique: boolean };

export interface SchemaEdit {
  rules: Rules;
  // the target table's complete index list; absent leaves `indexes` alone
  indexes?: IndexEdit[];
  // the target's complete set of expanded fields; absent leaves `expand` alone
  views?: string[];
}

function applyRules(doc: Document, entry: YAMLMap, rules: Rules): boolean {
  let changed = false;
  for (const key of RULE_KEYS) {
    const want = rules[key];
    const current = entry.get(key, true);
    if (Array.isArray(want)) {
      if (want.length === 0) {
        if (entry.has(key)) changed = entry.delete(key) || changed;
        continue;
      }
      if (same(current, want)) continue;
      entry.set(key, listNode(doc, want, current));
      changed = true;
      continue;
    }
    const pairs = Object.entries(want);
    if (pairs.length === 0) {
      if (entry.has(key)) changed = entry.delete(key) || changed;
      continue;
    }
    const map = blockMap(doc, entry, key);
    if (!isMap(current)) changed = true;
    for (const item of map.items.slice()) {
      if (!Object.hasOwn(want, keyText(item.key))) changed = map.delete(item.key) || changed;
    }
    for (const [column, value] of pairs) {
      const pair = map.items.find((item) => keyText(item.key) === column);
      if (pair && same(pair.value, value)) continue;
      if (pair) pair.value = listNode(doc, value, pair.value);
      else map.set(column, listNode(doc, value, undefined));
      changed = true;
    }
  }
  return changed;
}

const indexId = (spec: IndexSpec) => JSON.stringify([spec.columns ?? null, spec.expr ?? null, spec.unique]);

function indexNode(doc: Document, spec: IndexSpec): Node {
  const value = spec.columns
    ? spec.unique
      ? { columns: spec.columns, unique: true }
      : spec.columns
    : { expr: spec.expr, ...(spec.unique ? { unique: true } : {}) };
  const node = doc.createNode(value) as Node;
  if (isSeq(node) || isMap(node)) node.flow = true;
  return node;
}

function applyIndexes(doc: Document, entry: YAMLMap, table: string, indexes: IndexEdit[]): boolean {
  const wanted = new Map(indexes.map((raw, i) => toIndex(table, raw, i)).map((spec) => [indexId(spec), spec]));
  if (wanted.size === 0) return entry.delete("indexes");
  const current: unknown = entry.get("indexes", true);
  const list = isSeq(current) ? current : (doc.createNode([]) as YAMLSeq);
  let changed = list !== current;
  for (const item of list.items.slice()) {
    let id: string | null = null;
    try {
      id = indexId(toIndex(table, isNode(item) ? item.toJSON() : item, 0));
    } catch {
      // an invalid declaration is never wanted
    }
    if (id !== null && wanted.delete(id)) continue;
    list.items.splice(list.items.indexOf(item), 1);
    changed = true;
  }
  for (const spec of wanted.values()) {
    list.items.push(indexNode(doc, spec));
    changed = true;
  }
  if (list !== current) entry.set("indexes", list);
  return changed;
}

function applyViews(doc: Document, entry: YAMLMap, views: string[]): boolean {
  const wanted = new Set(views);
  if (wanted.size === 0) return entry.delete("expand");
  const current = entry.get("expand", true);
  const map = blockMap(doc, entry, "expand");
  let changed = !isMap(current);
  for (const item of map.items.slice()) {
    const field = keyText(item.key);
    if (wanted.delete(field)) continue;
    changed = map.delete(item.key) || changed;
  }
  for (const field of wanted) {
    map.set(field, doc.createNode({}));
    changed = true;
  }
  return changed;
}

// Sets one target's rules, indexes and views to exactly `edit`, editing only what differs.
// Returns the new text, or null when nothing changed.
export function applySchema(text: string, target: RuleTarget, edit: SchemaEdit): string | null {
  const doc = parseDocument(text);
  if (doc.errors.length > 0) throw new Error(`invalid yamlite.yaml: ${doc.errors[0]?.message.split("\n")[0]}`);
  if (edit.indexes !== undefined && target.path.length > 0) throw new Error("indexes belong to a table, not a view");
  const entry = ruleTarget(doc, target);
  let changed = applyRules(doc, entry, edit.rules);
  if (edit.indexes !== undefined) changed = applyIndexes(doc, entry, target.table, edit.indexes) || changed;
  if (edit.views !== undefined) changed = applyViews(doc, entry, edit.views) || changed;
  if (!changed) return null;
  const padded = /[[{] [^\s\]}]/.test(text);
  return doc.toString({ ...stringifyOptions(text), flowCollectionPadding: padded });
}
