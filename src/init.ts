import { existsSync, writeFileSync } from "node:fs";
import { isAbsolute, join, relative, resolve } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { Document, type YAMLSeq } from "yaml";
import { configPath, expandToRaw, filesOf, isConventional, referenceToRaw, resolveConfig } from "./config.ts";
import { isDate, isDatetime } from "./datetime.ts";
import { makeSource } from "./engine.ts";
import { MANAGED_PREFIX } from "./indexes.ts";
import { checkShapes, inferColumns, logicalType } from "./schema.ts";
import { STRINGIFY_OPTIONS } from "./source/yamldoc.ts";
import { q } from "./store.ts";
import type { ColumnFormat, ColumnType, IndexSpec, Rec, TableSpec } from "./types.ts";

export interface InitOptions {
  root: string;
  db?: string;
  force?: boolean;
}

const HEADER = [
  " The schema of record for this folder. yamlite adds new tables and columns here as it finds them;",
  " edit types, keys and indexes to change the database.",
].join("\n");

interface FoundIndex {
  spec: IndexSpec;
  adoptedFrom?: string;
}

const IDENT = /^\s*(?:"((?:[^"]|"")+)"|([A-Za-z_][\w$]*))\s*$/;

function splitTopLevel(text: string): string[] {
  const parts: string[] = [];
  let depth = 0;
  let quote: string | null = null;
  let start = 0;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (quote) {
      if (ch === quote) quote = null;
    } else if (ch === '"' || ch === "'" || ch === "`") quote = ch;
    else if (ch === "(") depth++;
    else if (ch === ")") depth--;
    else if (ch === "," && depth === 0) {
      parts.push(text.slice(start, i));
      start = i + 1;
    }
  }
  parts.push(text.slice(start));
  return parts;
}

// true when the column list ends before the text does, e.g. `a) WHERE (b`
function closesEarly(text: string): boolean {
  let depth = 0;
  let quote: string | null = null;
  for (const ch of text) {
    if (quote) {
      if (ch === quote) quote = null;
    } else if (ch === '"' || ch === "'" || ch === "`") quote = ch;
    else if (ch === "(") depth++;
    else if (ch === ")" && --depth < 0) return true;
  }
  return false;
}

// partial indexes (WHERE) cannot be declared and are left out
export function parseIndexSql(sql: string): IndexSpec | null {
  const m = /^\s*CREATE\s+(UNIQUE\s+)?INDEX\s+(?:IF\s+NOT\s+EXISTS\s+)?\S+\s+ON\s+\S+?\s*\(([\s\S]*)\)\s*$/i.exec(sql);
  if (!m) return null;
  const unique = m[1] !== undefined;
  const inner = (m[2] ?? "").trim();
  if (closesEarly(inner)) return null;
  const columns = splitTopLevel(inner).map((part) => {
    const id = IDENT.exec(part);
    return id ? (id[1]?.replaceAll('""', '"') ?? id[2] ?? null) : null;
  });
  if (columns.every((c): c is string => c !== null)) return { columns, unique };
  return { expr: inner, unique };
}

function openReadOnly(path: string): DatabaseSync | null {
  if (!existsSync(path)) return null;
  try {
    return new DatabaseSync(path, { readOnly: true });
  } catch {
    return null;
  }
}

function dbColumns(db: DatabaseSync | null, table: string): Map<string, ColumnType> | null {
  if (!db) return null;
  if (db.prepare("SELECT 1 FROM sqlite_schema WHERE type = 'table' AND name = ?").get(table) === undefined) return null;
  const rows = db.prepare(`PRAGMA table_info(${q(table)})`).all() as Array<{ name: string; type: string }>;
  return new Map(rows.map((r) => [r.name, logicalType(r.type)]));
}

function dbIndexes(db: DatabaseSync | null, table: string): FoundIndex[] {
  if (!db) return [];
  const rows = db
    .prepare(
      "SELECT name, sql FROM sqlite_schema WHERE type = 'index' AND tbl_name = ? AND sql IS NOT NULL ORDER BY rowid",
    )
    .all(table) as Array<{ name: string; sql: string }>;
  const found: FoundIndex[] = [];
  for (const row of rows) {
    const spec = parseIndexSql(row.sql);
    if (!spec) continue;
    found.push(row.name.startsWith(MANAGED_PREFIX) ? { spec } : { spec, adoptedFrom: row.name });
  }
  return found;
}

function columnsFor(
  spec: TableSpec,
  existing: Map<string, ColumnType> | null,
): { columns: Map<string, ColumnType>; records: Iterable<Rec> } {
  const files = makeSource(spec).read();
  if (files.tableError) throw new Error(`${spec.name}: ${files.tableError}`);
  const shapes = checkShapes(files.records, existing ?? new Map(), spec.columns);
  if (shapes.error) throw new Error(`${spec.name}: ${shapes.error}`);
  const columns = new Map(existing ?? []);
  for (const [column, type] of inferColumns(files.records.values())) {
    if (!columns.has(column)) columns.set(column, spec.columns[column] ?? type);
  }
  for (const [column, type] of Object.entries(spec.columns)) if (!existing?.has(column)) columns.set(column, type);
  if (spec.mode === "files") columns.delete(spec.key);
  return { columns, records: files.records.values() };
}

// TEXT columns that hold only dates (or dates and datetimes) get that format, so the UI offers a picker
function inferFormats(
  records: Iterable<Rec>,
  columns: Map<string, ColumnType>,
  spec: TableSpec,
): Record<string, ColumnFormat> {
  const seen = new Map<string, "date" | "datetime" | null>();
  for (const record of records) {
    for (const [column, value] of Object.entries(record)) {
      if (value === null || value === undefined || seen.get(column) === null) continue;
      const kind = isDate(value) ? "date" : isDatetime(value) ? "datetime" : null;
      seen.set(
        column,
        kind === null ? null : kind === "datetime" || seen.get(column) === "datetime" ? "datetime" : "date",
      );
    }
  }
  const formats: Record<string, ColumnFormat> = {};
  for (const [column, format] of seen) {
    if (format === null || columns.get(column) !== "TEXT") continue;
    if (Object.hasOwn(spec.formats, column) || Object.hasOwn(spec.values, column)) continue;
    formats[column] = format;
  }
  return formats;
}

function displayPath(root: string, path: string): string {
  const rel = relative(root, path);
  return rel.startsWith("..") || isAbsolute(rel) ? path : rel;
}

export function generateConfig(opts: InitOptions): string {
  const root = resolve(opts.root);
  if (configPath(root) !== null && !opts.force) {
    throw new Error(`${configPath(root)} already exists; use --force to overwrite it`);
  }
  const config = resolveConfig({ root, db: opts.db }, { requireConfig: false });
  const db = openReadOnly(config.db);
  try {
    const doc = new Document({ tables: {} });
    doc.commentBefore = HEADER;
    const tables = doc.get("tables", true) as unknown as { set: (k: string, v: unknown) => void };
    for (const spec of [...config.tables].sort((a, b) => a.name.localeCompare(b.name))) {
      const entry: Record<string, unknown> = {};
      if (!isConventional(root, spec)) {
        if (spec.mode === "files") entry.files = filesOf(root, spec);
        else entry.path = displayPath(root, spec.path);
      }
      if (spec.body !== null && spec.body !== "body") entry.body = spec.body;
      if (spec.key !== "id") entry.key = spec.key;
      const { columns, records } = columnsFor(spec, dbColumns(db, spec.name));
      if (columns.size > 0) entry.columns = Object.fromEntries(columns);
      // the body column's markdown format comes with body:, so it is not written out
      const formats = {
        ...Object.fromEntries(
          Object.entries(spec.formats).filter(([column, format]) => !(column === spec.body && format === "markdown")),
        ),
        ...inferFormats(records, columns, spec),
      };
      if (Object.keys(formats).length > 0) entry.formats = formats;
      if (spec.references.length > 0) {
        entry.references = Object.fromEntries(spec.references.map((r) => [r.column, referenceToRaw(r)]));
      }
      if (Object.keys(spec.values).length > 0) entry.values = { ...spec.values };
      if (spec.required.length > 0) entry.required = [...spec.required];
      if (Object.keys(spec.min).length > 0) entry.min = { ...spec.min };
      if (Object.keys(spec.max).length > 0) entry.max = { ...spec.max };
      if (spec.expand.length > 0) entry.expand = expandToRaw(spec.expand);
      const node = doc.createNode(entry);
      const found = dbIndexes(db, spec.name);
      const declared: FoundIndex[] = found.length > 0 ? found : spec.indexes.map((s) => ({ spec: s }));
      if (declared.length > 0) {
        const items = doc.createNode([]) as YAMLSeq;
        for (const { spec: ix, adoptedFrom } of declared) {
          const value =
            ix.columns && !ix.unique
              ? ix.columns
              : {
                  ...(ix.columns ? { columns: ix.columns } : { expr: ix.expr }),
                  ...(ix.unique ? { unique: true } : {}),
                };
          const item = doc.createNode(value, { flow: true });
          if (adoptedFrom)
            item.commentBefore = ` replaces index "${adoptedFrom}" created outside yamlite; drop it after adopting`;
          items.items.push(item);
        }
        (node as unknown as { set: (k: string, v: unknown) => void }).set("indexes", items);
      }
      tables.set(spec.name, node);
    }
    return doc.toString(STRINGIFY_OPTIONS);
  } finally {
    db?.close();
  }
}

export function init(opts: InitOptions): { path: string; tables: string[] } {
  const content = generateConfig(opts);
  const root = resolve(opts.root);
  const path = configPath(root) ?? join(root, "yamlite.yaml");
  writeFileSync(path, content);
  return { path, tables: resolveConfig({ root, db: opts.db }).tables.map((t) => t.name) };
}
