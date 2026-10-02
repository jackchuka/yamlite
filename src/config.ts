import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, isAbsolute, join, resolve, sep } from "node:path";
import { parse } from "yaml";
import { YAML_EXT } from "./source/yamldoc.ts";
import {
  COLUMN_TYPES,
  type ColumnType,
  type ExpandSpec,
  type IndexSpec,
  type Mode,
  type Reference,
  type TableSpec,
} from "./types.ts";
import { declaredViews } from "./views.ts";

export interface TableInput {
  name: string;
  path: string;
  key?: string;
  columns?: Record<string, string>;
  indexes?: unknown[];
  references?: Record<string, unknown>;
  expand?: Record<string, unknown>;
}

export interface OpenOptions {
  root?: string;
  db?: string;
  tables?: TableInput[];
}

export interface ResolvedConfig {
  db: string;
  stateDir: string;
  tables: TableSpec[];
}

const CONFIG_NAMES = ["yamlite.yaml", "yamlite.yml"];

export function expandPath(p: string, base: string): string {
  if (p === "~") return homedir();
  if (p.startsWith("~/")) return join(homedir(), p.slice(2));
  return isAbsolute(p) ? p : resolve(base, p);
}

export function detectMode(path: string): Mode {
  if (existsSync(path)) return statSync(path).isDirectory() ? "dir" : "list";
  return YAML_EXT.test(path) ? "list" : "dir";
}

function scanRoot(root: string): TableInput[] {
  const out: TableInput[] = [];
  for (const entry of readdirSync(root, { withFileTypes: true })) {
    const name = entry.name;
    if (name.startsWith(".") || name === "node_modules" || CONFIG_NAMES.includes(name)) continue;
    const path = join(root, name);
    let kind: { isDirectory(): boolean; isFile(): boolean } = entry;
    if (entry.isSymbolicLink()) {
      try {
        kind = statSync(path);
      } catch {
        continue;
      }
    }
    if (kind.isDirectory()) out.push({ name, path });
    else if (kind.isFile() && YAML_EXT.test(name)) out.push({ name: name.replace(YAML_EXT, ""), path });
  }
  return out.sort((a, b) => a.name.localeCompare(b.name));
}

interface RawTable {
  path?: string;
  key?: string;
  columns?: Record<string, string>;
  indexes?: unknown[];
  references?: Record<string, unknown>;
  expand?: Record<string, unknown>;
}

export function configPath(root: string): string | null {
  for (const file of CONFIG_NAMES) {
    const path = join(resolve(root), file);
    if (existsSync(path)) return path;
  }
  return null;
}

// a listed table without a path lives next to the config: <name>.yaml / <name>.yml if present, else <name>/
function defaultPath(root: string, name: string): string {
  for (const ext of [".yaml", ".yml"]) {
    if (existsSync(join(root, `${name}${ext}`))) return join(root, `${name}${ext}`);
  }
  return join(root, name);
}

export function listedTables(path: string): Record<string, unknown> {
  const raw = parse(readFileSync(path, "utf8")) as { tables?: Record<string, unknown> } | null;
  return raw?.tables ?? {};
}

function readRootConfig(root: string): Array<{ name: string } & RawTable> {
  const path = configPath(root);
  if (path === null) return [];
  let raw: { tables?: Record<string, RawTable | null> } | null;
  try {
    raw = parse(readFileSync(path, "utf8"));
  } catch (e) {
    const first = (e instanceof Error ? e.message : String(e)).split("\n")[0];
    throw new Error(`invalid ${path}: ${first}`);
  }
  return Object.entries(raw?.tables ?? {}).map(([name, t]) => ({ name, ...t }));
}

function toSpec(t: TableInput, persisted: boolean): TableSpec {
  if (!t.name || t.name.startsWith("_yamlite") || /[/\\\0]/.test(t.name) || t.name === "." || t.name.includes("..")) {
    throw new Error(`invalid table name: "${t.name}"`);
  }
  return {
    name: t.name,
    path: t.path,
    mode: detectMode(t.path),
    key: t.key ?? "id",
    columns: toColumns(`table "${t.name}": `, t.columns),
    indexes: (t.indexes ?? []).map((raw, i) => toIndex(t.name, raw, i)),
    references: Object.entries(t.references ?? {}).map(([column, raw]) =>
      toReference(`table "${t.name}": `, column, raw),
    ),
    persisted,
    exclude: [],
    expand: toExpand(t.name, t.name, t.expand, "expand"),
  };
}

function withExcludes(tables: TableSpec[]): TableSpec[] {
  return tables.map((t) =>
    t.mode === "dir" ? { ...t, exclude: tables.filter((o) => o.path.startsWith(t.path + sep)).map((o) => o.path) } : t,
  );
}

const REFERENCE = /^([^.\s]+)(?:\.([^.\s]+))?$/;

function toColumns(where: string, raw: Record<string, string> | undefined): Record<string, ColumnType> {
  // no prototype, so that a field named "constructor" or "toString" is not mistaken for a declared column
  const columns: Record<string, ColumnType> = Object.create(null);
  for (const [column, type] of Object.entries(raw ?? {})) {
    const upper = String(type).toUpperCase() as ColumnType;
    if (!COLUMN_TYPES.includes(upper)) throw new Error(`${where}unknown column type ${type} for "${column}"`);
    columns[column] = upper;
  }
  return columns;
}

// `table` (its key column) or `table.column`
function toReference(where: string, column: string, raw: unknown): Reference {
  const m = typeof raw === "string" ? REFERENCE.exec(raw.trim()) : null;
  if (!m?.[1]) throw new Error(`${where}references.${column} must be "table" or "table.column"`);
  return m[2] ? { column, table: m[1], target: m[2] } : { column, table: m[1] };
}

export const referenceToRaw = (r: Reference): string => (r.target ? `${r.table}.${r.target}` : r.table);

const EXPAND_KEYS = ["columns", "references", "expand"];

// `expand: { <field>: { columns?, references?, expand? } | null }`: one view per field, named <parent>__<field>
function toExpand(table: string, parent: string, raw: unknown, path: string): ExpandSpec[] {
  if (raw === undefined || raw === null) return [];
  if (typeof raw !== "object" || Array.isArray(raw))
    throw new Error(`table "${table}": ${path} must be a map of fields`);
  return Object.entries(raw).map(([field, value]) => {
    const where = `${path}.${field}`;
    if (field === "" || field.includes("\0"))
      throw new Error(`table "${table}": invalid field name in ${path}: "${field}"`);
    if (value !== null && value !== undefined && (typeof value !== "object" || Array.isArray(value))) {
      throw new Error(`table "${table}": ${where} must be a map of columns, references and expand`);
    }
    const v = (value ?? {}) as {
      columns?: Record<string, string>;
      references?: Record<string, unknown>;
      expand?: unknown;
    };
    const unknown = Object.keys(v).find((k) => !EXPAND_KEYS.includes(k));
    if (unknown !== undefined) throw new Error(`table "${table}": ${where} has an unknown key "${unknown}"`);
    const name = `${parent}__${field}`;
    return {
      field,
      name,
      columns: toColumns(`table "${table}": ${where}: `, v.columns),
      references: Object.entries(v.references ?? {}).map(([column, r]) =>
        toReference(`table "${table}": ${where}.`, column, r),
      ),
      expand: toExpand(table, name, v.expand, `${where}.expand`),
    };
  });
}

export function expandToRaw(list: ExpandSpec[]): Record<string, unknown> {
  return Object.fromEntries(
    list.map((e) => [
      e.field,
      {
        ...(Object.keys(e.columns).length > 0 ? { columns: e.columns } : {}),
        ...(e.references.length > 0
          ? { references: Object.fromEntries(e.references.map((r) => [r.column, referenceToRaw(r)])) }
          : {}),
        ...(e.expand.length > 0 ? { expand: expandToRaw(e.expand) } : {}),
      },
    ]),
  );
}

function checkViewNames(tables: TableSpec[]): TableSpec[] {
  const used = new Map(tables.map((t) => [t.name, `table "${t.name}"`]));
  for (const t of tables) {
    for (const { spec } of declaredViews(t)) {
      const other = used.get(spec.name);
      if (other) throw new Error(`table "${t.name}": view name "${spec.name}" is already used by ${other}`);
      used.set(spec.name, `a view of table "${t.name}"`);
    }
  }
  return tables;
}

const isStringList = (v: unknown): v is string[] =>
  Array.isArray(v) && v.length > 0 && v.every((c) => typeof c === "string" && c !== "");

// accepts `[a, b]`, `{ columns: [a, b] | a, unique? }` or `{ expr: "...", unique? }`
function toIndex(table: string, raw: unknown, i: number): IndexSpec {
  const invalid = () =>
    new Error(`table "${table}": index #${i + 1} must be a list of columns, { columns, unique? } or { expr, unique? }`);
  if (isStringList(raw)) return { columns: raw, unique: false };
  if (raw === null || typeof raw !== "object" || Array.isArray(raw)) throw invalid();
  const { columns, expr, unique = false } = raw as { columns?: unknown; expr?: unknown; unique?: unknown };
  if (typeof unique !== "boolean") throw invalid();
  const cols = typeof columns === "string" ? [columns] : columns;
  if (cols !== undefined && expr === undefined && isStringList(cols)) return { columns: cols, unique };
  if (cols === undefined && typeof expr === "string" && expr.trim() !== "") {
    if (/;|--|\/\*/.test(expr)) throw new Error(`table "${table}": index #${i + 1} expr must be a single expression`);
    return { expr: expr.trim(), unique };
  }
  throw invalid();
}

export function resolveConfig(opts: OpenOptions, { requireConfig = true } = {}): ResolvedConfig {
  if (opts.root !== undefined) {
    const root = resolve(opts.root);
    if (!existsSync(root) || !statSync(root).isDirectory()) throw new Error(`root is not a directory: ${root}`);
    if (requireConfig && configPath(root) === null) {
      throw new Error(`no yamlite.yaml in ${root}; run "yamlite init" to create it`);
    }
    const merged = new Map(scanRoot(root).map((t) => [t.name, t]));
    for (const o of readRootConfig(root)) {
      const prev = merged.get(o.name);
      const path = o.path ? expandPath(o.path, root) : (prev?.path ?? defaultPath(root, o.name));
      merged.set(o.name, {
        name: o.name,
        path,
        key: o.key ?? prev?.key,
        columns: { ...prev?.columns, ...o.columns },
        indexes: o.indexes ?? prev?.indexes,
        references: o.references ?? prev?.references,
        expand: o.expand ?? prev?.expand,
      });
    }
    const inCode = new Set<string>();
    for (const t of opts.tables ?? []) {
      merged.set(t.name, { ...t, path: expandPath(t.path, root) });
      inCode.add(t.name);
    }
    return {
      db: opts.db ? expandPath(opts.db, process.cwd()) : join(root, ".yamlite", "db.sqlite"),
      stateDir: join(root, ".yamlite"),
      tables: checkViewNames(withExcludes([...merged.values()].map((t) => toSpec(t, !inCode.has(t.name))))),
    };
  }
  if (!opts.db) throw new Error("either root or db is required");
  const db = expandPath(opts.db, process.cwd());
  return {
    db,
    stateDir: join(dirname(db), ".yamlite"),
    tables: checkViewNames(
      withExcludes((opts.tables ?? []).map((t) => toSpec({ ...t, path: expandPath(t.path, process.cwd()) }, false))),
    ),
  };
}
