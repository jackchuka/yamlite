import { type Dirent, existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { parse } from "yaml";
import { instant, isDate, isDatetime } from "./datetime.ts";
import { claims } from "./source/files.ts";
import { markdownExt } from "./source/markdown.ts";
import { YAML_EXT, YAML_GLOB } from "./source/yamldoc.ts";
import {
  type AllowedValue,
  type Bound,
  COLUMN_FORMATS,
  COLUMN_TYPES,
  type ColumnFormat,
  type ColumnType,
  type Claim,
  type ExpandSpec,
  type IndexSpec,
  type PageAccess,
  type PageSpec,
  type Reference,
  type TableSpec,
} from "./types.ts";
import { declaredViews } from "./views.ts";

export interface TableInput {
  name: string;
  // a YAML file holding a list of records
  path?: string;
  // a glob of files, one record each
  files?: string;
  key?: string;
  // markdown tables: the column for the text below the front matter
  body?: string;
  columns?: Record<string, string>;
  formats?: Record<string, string>;
  indexes?: unknown[];
  references?: Record<string, unknown>;
  values?: unknown;
  required?: unknown;
  min?: unknown;
  max?: unknown;
  expand?: Record<string, unknown>;
  group?: string;
}

// a table input whose files are found: path is absolute, glob is null for a list table
type Located = Omit<TableInput, "path" | "files"> & { path: string; glob: string | null };

export interface OpenOptions {
  root?: string;
  db?: string;
  tables?: TableInput[];
  stateDir?: string;
  persistConfig?: boolean;
}

export interface ResolvedConfig {
  db: string;
  stateDir: string;
  tables: TableSpec[];
  pages: PageSpec[];
}

const CONFIG_NAMES = ["yamlite.yaml", "yamlite.yml"];

export function expandPath(p: string, base: string): string {
  if (p === "~") return homedir();
  if (p.startsWith("~/")) return join(homedir(), p.slice(2));
  return isAbsolute(p) ? p : resolve(base, p);
}

const WILDCARD = /[*?[{]/;
const FILE_GLOB_TAIL = /\*\.(?:mdx?|ya?ml|\{yaml,yml\}|\{yml,yaml\})$/;

// "content/blog/**/*.yaml" → base "content/blog", glob "**/*.yaml"
export function splitFiles(where: string, files: string): { base: string; glob: string } {
  const parts = files.split("/");
  const i = parts.findIndex((p) => WILDCARD.test(p));
  if (i < 0 || !FILE_GLOB_TAIL.test(files)) {
    throw new Error(`${where}files must end in *.md, *.mdx, *.yaml, *.yml or *.{yaml,yml}`);
  }
  const tail = parts.slice(i);
  if (tail.some((p) => p === "." || p === "..")) throw new Error(`${where}files cannot use . or .. after a wildcard`);
  return { base: parts.slice(0, i).join("/"), glob: tail.join("/") };
}

class FolderPathError extends Error {}

function locate(
  where: string,
  t: { path?: string; files?: string },
  base: string,
  conventional?: { name: string; root: string },
): { path: string; glob: string | null } {
  if (t.path !== undefined && t.files !== undefined) throw new Error(`${where}use either path or files, not both`);
  if (t.files !== undefined) {
    const split = splitFiles(where, t.files);
    return { path: expandPath(split.base === "" ? "." : split.base, base), glob: split.glob };
  }
  if (t.path === undefined) throw new Error(`${where}needs path or files`);
  const path = expandPath(t.path, base);
  if ((existsSync(path) && statSync(path).isDirectory()) || !YAML_EXT.test(path)) {
    const dir = t.path.replace(/^\.\//, "").replace(/^\.$/, "").replace(/\/+$/, "");
    const glob = dir === "" ? YAML_GLOB : `${dir}/${YAML_GLOB}`;
    const isDefault = conventional !== undefined && path === join(conventional.root, conventional.name);
    throw new FolderPathError(
      isDefault
        ? `${where}path must be a YAML file; remove the path: line (the folder ${conventional.name}/ is the default) or use files: "${glob}"`
        : `${where}path must be a YAML file; for one record per file use files: "${glob}"`,
    );
  }
  return { path, glob: null };
}

// how yamlite.yaml writes a files table: relative to the root inside it, absolute outside
export function filesOf(root: string, spec: TableSpec): string {
  const rel = relative(root, spec.path);
  if (rel === "") return spec.glob ?? "";
  const base = rel.startsWith("..") || isAbsolute(rel) ? spec.path : rel.split(sep).join("/");
  return `${base}/${spec.glob}`;
}

// whether a folder holds files at some depth but no YAML file among them; stops at the first YAML file
function hasFilesButNoYaml(dir: string): boolean {
  let files = false;
  let yaml = false;
  const visit = (d: string) => {
    let entries: Dirent[];
    try {
      entries = readdirSync(d, { withFileTypes: true });
    } catch {
      return;
    }
    for (const e of entries) {
      if (yaml) return;
      if (e.name.startsWith(".") || e.name === "node_modules") continue;
      if (e.isDirectory()) visit(join(d, e.name));
      else {
        files = true;
        if (YAML_EXT.test(e.name)) yaml = true;
      }
    }
  };
  visit(dir);
  return files && !yaml;
}

function scanRoot(root: string): Located[] {
  const out: Located[] = [];
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
    if (kind.isDirectory()) {
      // Markdown tables are only ever declared; a folder of other files (Markdown notes, images) is no table,
      // while a folder with no files at all still is
      if (hasFilesButNoYaml(path)) continue;
      out.push({ name, path, glob: YAML_GLOB });
    } else if (kind.isFile() && YAML_EXT.test(name)) {
      out.push({ name: name.replace(YAML_EXT, ""), path, glob: null });
    }
  }
  return out.sort((a, b) => a.name.localeCompare(b.name));
}

// a table yamlite.yaml can list without path: or files: (the conventions find it there)
export function isConventional(root: string, spec: TableSpec): boolean {
  if (spec.mode === "files") {
    return spec.codec === "yaml" && spec.path === join(root, spec.name) && spec.glob === YAML_GLOB;
  }
  return [join(root, `${spec.name}.yaml`), join(root, `${spec.name}.yml`)].includes(spec.path);
}

interface RawTable {
  path?: string;
  files?: string;
  key?: string;
  body?: string;
  columns?: Record<string, string>;
  formats?: Record<string, string>;
  indexes?: unknown[];
  references?: Record<string, unknown>;
  values?: unknown;
  required?: unknown;
  min?: unknown;
  max?: unknown;
  expand?: Record<string, unknown>;
  group?: unknown;
}

export function configPath(root: string): string | null {
  for (const file of CONFIG_NAMES) {
    const path = join(resolve(root), file);
    if (existsSync(path)) return path;
  }
  return null;
}

// a listed table without a path or files lives next to the config: <name>.yaml / <name>.yml if present, else <name>/
function defaultLocation(root: string, name: string): { path: string; glob: string | null } {
  for (const ext of [".yaml", ".yml"]) {
    const path = join(root, `${name}${ext}`);
    if (existsSync(path)) return { path, glob: null };
  }
  return { path: join(root, name), glob: YAML_GLOB };
}

export function listedTables(path: string): Record<string, unknown> {
  const raw = parse(readFileSync(path, "utf8")) as { tables?: Record<string, unknown> } | null;
  return raw?.tables ?? {};
}

function readRootConfig(root: string): { tables: Array<{ name: string } & RawTable>; pages: unknown } {
  const path = configPath(root);
  if (path === null) return { tables: [], pages: undefined };
  let raw: { tables?: Record<string, RawTable | null>; pages?: unknown } | null;
  try {
    raw = parse(readFileSync(path, "utf8"));
  } catch (e) {
    const first = (e instanceof Error ? e.message : String(e)).split("\n")[0];
    throw new Error(`invalid ${path}: ${first}`);
  }
  return { tables: Object.entries(raw?.tables ?? {}).map(([name, t]) => ({ name, ...t })), pages: raw?.pages };
}

function toSpec(t: Located, persisted: boolean): TableSpec {
  if (!t.name || t.name.startsWith("_yamlite") || /[/\\\0]/.test(t.name) || t.name === "." || t.name.includes("..")) {
    throw new Error(`invalid table name: "${t.name}"`);
  }
  const where = `table "${t.name}": `;
  const columns = toColumns(where, t.columns);
  const codec = markdownExt(t.glob) !== null ? "markdown" : "yaml";
  if (t.body !== undefined) {
    if (codec !== "markdown") throw new Error(`${where}body is only for *.md and *.mdx files`);
    if (typeof t.body !== "string" || t.body === "") throw new Error(`${where}body must be a column name`);
    if (t.body === (t.key ?? "id")) throw new Error(`${where}body cannot be the key column`);
  }
  const body = codec === "markdown" ? (t.body ?? "body") : null;
  if (t.group !== undefined && (typeof t.group !== "string" || t.group.trim() === "")) {
    throw new Error(`${where}group must be a non-empty string`);
  }
  const formats = toFormats(where, body === null ? t.formats : { [body]: "markdown", ...t.formats }, columns);
  return {
    name: t.name,
    path: t.path,
    mode: t.glob === null ? "list" : "files",
    glob: t.glob,
    codec,
    body,
    key: t.key ?? "id",
    columns,
    formats,
    indexes: (t.indexes ?? []).map((raw, i) => toIndex(t.name, raw, i)),
    references: Object.entries(t.references ?? {}).map(([column, raw]) =>
      toReference(`table "${t.name}": `, column, raw),
    ),
    values: toValues(where, t.values, formats),
    required: toRequired(where, t.required),
    ...toBounds(where, t, columns, formats),
    persisted,
    exclude: [],
    expand: toExpand(t.name, t.name, t.expand, "expand"),
    group: t.group ?? null,
  };
}

// the most specific table owns a file: a table excludes the files of every table inside its folder,
// and a table with the same folder that matches the same file is an error for both
function withClaims(tables: TableSpec[], configFiles: string[]): TableSpec[] {
  return tables.map((t) => {
    if (t.mode !== "files") return t;
    const inside = (o: TableSpec) =>
      o !== t && (o.mode === "files" && o.path === t.path ? true : o.path.startsWith(t.path + sep));
    const exclude: Claim[] = tables.filter(inside).map((o) => ({
      owner: `table "${o.name}"`,
      path: o.path,
      glob: o.glob,
      tie: o.mode === "files" && o.path === t.path,
    }));
    for (const path of configFiles) {
      if (path.startsWith(t.path + sep)) exclude.push({ owner: basename(path), path, glob: null, tie: false });
    }
    return { ...t, exclude };
  });
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

// how the UI edits a column, kept apart from its type: markdown is stored as plain TEXT
function toFormats(where: string, raw: unknown, columns: Record<string, ColumnType>): Record<string, ColumnFormat> {
  const formats: Record<string, ColumnFormat> = Object.create(null);
  if (raw === undefined || raw === null) return formats;
  if (typeof raw !== "object" || Array.isArray(raw))
    throw new Error(`${where}formats must be a map of columns to formats`);
  for (const [column, format] of Object.entries(raw)) {
    const lower = String(format).toLowerCase() as ColumnFormat;
    if (!COLUMN_FORMATS.includes(lower)) throw new Error(`${where}unknown format ${format} for "${column}"`);
    const type = Object.hasOwn(columns, column) ? columns[column] : undefined;
    if (type !== undefined && type !== "TEXT") {
      throw new Error(`${where}formats.${column}: ${lower} needs a TEXT column, not ${type}`);
    }
    formats[column] = lower;
  }
  return formats;
}

const isScalar = (v: unknown): v is AllowedValue =>
  typeof v === "string" || typeof v === "number" || typeof v === "boolean";

// allowed values are checked against the data, never enforced; a markdown column holds free text
function toValues(where: string, raw: unknown, formats: Record<string, ColumnFormat>): Record<string, AllowedValue[]> {
  const values: Record<string, AllowedValue[]> = Object.create(null);
  if (raw === undefined || raw === null) return values;
  if (typeof raw !== "object" || Array.isArray(raw))
    throw new Error(`${where}values must be a map of columns to lists`);
  for (const [column, list] of Object.entries(raw)) {
    if (!Array.isArray(list) || list.length === 0 || !list.every(isScalar)) {
      throw new Error(`${where}values.${column} must be a non-empty list of strings, numbers or booleans`);
    }
    if (Object.hasOwn(formats, column))
      throw new Error(`${where}values.${column}: a ${formats[column]} column cannot have values`);
    values[column] = [...new Set(list)];
  }
  return values;
}

// bounds are checked against the data, never enforced; what a bound may be follows the column's type or format
function toBounds(
  where: string,
  raw: { min?: unknown; max?: unknown },
  columns: Record<string, ColumnType>,
  formats: Record<string, ColumnFormat>,
): { min: Record<string, Bound>; max: Record<string, Bound> } {
  const read = (which: "min" | "max") => {
    const bounds: Record<string, Bound> = Object.create(null);
    const value = raw[which];
    if (value === undefined || value === null) return bounds;
    if (typeof value !== "object" || Array.isArray(value))
      throw new Error(`${where}${which} must be a map of columns to numbers or dates`);
    for (const [column, b] of Object.entries(value)) {
      const format = Object.hasOwn(formats, column) ? formats[column] : undefined;
      const type = Object.hasOwn(columns, column) ? columns[column] : undefined;
      if (format === "date" || format === "datetime") {
        const ok = typeof b === "string" && (isDate(b) || (format === "datetime" && isDatetime(b)));
        if (!ok) throw new Error(`${where}${which}.${column}: ${JSON.stringify(b)} is not a ${format}`);
      } else if (type === "INTEGER" || type === "REAL") {
        if (typeof b !== "number" || !Number.isFinite(b))
          throw new Error(`${where}${which}.${column}: ${JSON.stringify(b)} is not a number`);
      } else {
        throw new Error(`${where}${which}.${column} needs an INTEGER or REAL column, or a date or datetime format`);
      }
      bounds[column] = b as Bound;
    }
    return bounds;
  };
  const min = read("min");
  const max = read("max");
  const at = (b: Bound) => (typeof b === "number" ? b : (instant(b) as number));
  for (const column of Object.keys(min)) {
    const low = min[column] as Bound;
    const high = Object.hasOwn(max, column) ? max[column] : undefined;
    if (high !== undefined && at(low) > at(high)) {
      throw new Error(`${where}min.${column} (${low}) is above max.${column} (${high})`);
    }
  }
  return { min, max };
}

function toRequired(where: string, raw: unknown): string[] {
  if (raw === undefined || raw === null) return [];
  if (!Array.isArray(raw) || raw.length === 0 || !raw.every((c) => typeof c === "string" && c !== "")) {
    throw new Error(`${where}required must be a non-empty list of column names`);
  }
  return [...new Set(raw as string[])];
}

// `table` (its key column) or `table.column`
function toReference(where: string, column: string, raw: unknown): Reference {
  const m = typeof raw === "string" ? REFERENCE.exec(raw.trim()) : null;
  if (!m?.[1]) throw new Error(`${where}references.${column} must be "table" or "table.column"`);
  return m[2] ? { column, table: m[1], target: m[2] } : { column, table: m[1] };
}

export const referenceToRaw = (r: Reference): string => (r.target ? `${r.table}.${r.target}` : r.table);

const EXPAND_KEYS = ["columns", "formats", "references", "values", "required", "min", "max", "expand"];

// `expand: { <field>: { columns?, formats?, references?, values?, required?, min?, max?, expand? } | null }`: one view per field, named <parent>__<field>
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
      formats?: unknown;
      references?: Record<string, unknown>;
      values?: unknown;
      required?: unknown;
      min?: unknown;
      max?: unknown;
      expand?: unknown;
    };
    const unknown = Object.keys(v).find((k) => !EXPAND_KEYS.includes(k));
    if (unknown !== undefined) throw new Error(`table "${table}": ${where} has an unknown key "${unknown}"`);
    const name = `${parent}__${field}`;
    const columns = toColumns(`table "${table}": ${where}: `, v.columns);
    const formats = toFormats(`table "${table}": ${where}.`, v.formats, columns);
    return {
      field,
      name,
      columns,
      formats,
      references: Object.entries(v.references ?? {}).map(([column, r]) =>
        toReference(`table "${table}": ${where}.`, column, r),
      ),
      values: toValues(`table "${table}": ${where}.`, v.values, formats),
      required: toRequired(`table "${table}": ${where}.`, v.required),
      ...toBounds(`table "${table}": ${where}.`, v, columns, formats),
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
        ...(Object.keys(e.formats).length > 0 ? { formats: { ...e.formats } } : {}),
        ...(e.references.length > 0
          ? { references: Object.fromEntries(e.references.map((r) => [r.column, referenceToRaw(r)])) }
          : {}),
        ...(Object.keys(e.values).length > 0 ? { values: { ...e.values } } : {}),
        ...(e.required.length > 0 ? { required: [...e.required] } : {}),
        ...(Object.keys(e.min).length > 0 ? { min: { ...e.min } } : {}),
        ...(Object.keys(e.max).length > 0 ? { max: { ...e.max } } : {}),
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

const PAGE_KEYS = ["path", "title", "access", "sql", "network"];
const PAGE_NAME = /^[a-z0-9][a-z0-9_-]*$/;

function toOrigin(where: string, raw: unknown): string {
  const invalid = () =>
    new Error(`${where}network entries must be origins like https://cdn.example.com, not ${JSON.stringify(raw)}`);
  if (typeof raw !== "string" || raw.includes("*")) throw invalid();
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw invalid();
  }
  if ((url.protocol !== "https:" && url.protocol !== "http:") || raw.replace(/\/$/, "") !== url.origin) throw invalid();
  return url.origin;
}

function toPages(raw: unknown, root: string, tables: TableSpec[]): PageSpec[] {
  if (raw === undefined || raw === null) return [];
  if (typeof raw !== "object" || Array.isArray(raw)) throw new Error("pages must be a map of page names");
  const tableNames = new Set(tables.map((t) => t.name));
  const viewNames = new Set(tables.flatMap((t) => declaredViews(t).map((d) => d.spec.name)));
  return Object.entries(raw).map(([name, value]) => {
    if (!PAGE_NAME.test(name)) {
      throw new Error(`invalid page name: "${name}"; use lowercase letters, digits, - and _`);
    }
    const where = `page "${name}": `;
    if (value === null || typeof value !== "object" || Array.isArray(value)) {
      throw new Error(`${where}must be a map with a path`);
    }
    const v = value as Record<string, unknown>;
    const unknown = Object.keys(v).find((k) => !PAGE_KEYS.includes(k));
    if (unknown !== undefined) throw new Error(`${where}unknown key "${unknown}"`);
    if (typeof v.path !== "string" || v.path === "") throw new Error(`${where}path is required`);
    if (!/\.html$/i.test(v.path)) throw new Error(`${where}path must be an .html file`);
    if (v.title !== undefined && typeof v.title !== "string") throw new Error(`${where}title must be a string`);
    if (v.sql !== undefined && typeof v.sql !== "boolean") throw new Error(`${where}sql must be true or false`);
    if (v.network !== undefined && !Array.isArray(v.network)) {
      throw new Error(`${where}network must be a list of origins`);
    }
    if (v.access !== undefined && v.access !== null && (typeof v.access !== "object" || Array.isArray(v.access))) {
      throw new Error(`${where}access must be a map of tables to read or write`);
    }
    const access: Record<string, PageAccess> = {};
    for (const [target, level] of Object.entries((v.access ?? {}) as Record<string, unknown>)) {
      if (target.startsWith("_yamlite")) {
        throw new Error(`${where}${target} is yamlite's bookkeeping and cannot be in access`);
      }
      if (level !== "read" && level !== "write") throw new Error(`${where}access.${target} must be read or write`);
      if (viewNames.has(target)) {
        if (level === "write") throw new Error(`${where}view "${target}" can only be read`);
      } else if (!tableNames.has(target)) {
        throw new Error(`${where}unknown table or view "${target}" in access`);
      }
      access[target] = level;
    }
    return {
      name,
      path: expandPath(v.path, root),
      title: (v.title as string | undefined) ?? name,
      access,
      sql: v.sql === true,
      network: ((v.network ?? []) as unknown[]).map((o) => toOrigin(where, o)),
    };
  });
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
    const scanned = scanRoot(root);
    const raw = readRootConfig(root);
    const declared = new Map<string, Located>();
    const pathErrors: string[] = [];
    for (const o of raw.tables) {
      const where = `table "${o.name}": `;
      const prev = scanned.find((s) => s.name === o.name);
      let loc: { path: string; glob: string | null };
      try {
        loc =
          o.path !== undefined || o.files !== undefined
            ? locate(where, o, root, { name: o.name, root })
            : prev
              ? { path: prev.path, glob: prev.glob }
              : defaultLocation(root, o.name);
      } catch (e) {
        if (!(e instanceof FolderPathError)) throw e;
        pathErrors.push(e.message);
        continue;
      }
      declared.set(o.name, {
        name: o.name,
        ...loc,
        key: o.key,
        body: o.body,
        columns: o.columns,
        formats: o.formats,
        indexes: o.indexes,
        references: o.references,
        values: o.values,
        required: o.required,
        min: o.min,
        max: o.max,
        expand: o.expand,
        group: o.group as string | undefined,
      });
    }
    if (pathErrors.length > 0) throw new Error(pathErrors.join("\n"));
    const inCode = new Set<string>();
    for (const t of opts.tables ?? []) {
      declared.set(t.name, { ...t, ...locate(`table "${t.name}": `, t, root) });
      inCode.add(t.name);
    }
    // a declared files table covering a folder or file keeps the conventions from making it a table of its own
    const codecOf = (glob: string | null) => (markdownExt(glob) !== null ? "markdown" : "yaml");
    const globs = [...declared.values()].filter((d) => d.glob !== null);
    const covered = (s: Located) =>
      s.glob !== null
        ? globs.some(
            (d) => codecOf(d.glob) === codecOf(s.glob) && (s.path === d.path || s.path.startsWith(d.path + sep)),
          )
        : globs.some((d) => claims({ owner: "", path: d.path, glob: d.glob, tie: false }, s.path));
    const merged = new Map<string, Located>();
    for (const s of scanned) {
      const d = declared.get(s.name);
      if (d) merged.set(s.name, d);
      else if (!covered(s)) merged.set(s.name, s);
    }
    for (const [name, d] of declared) if (!merged.has(name)) merged.set(name, d);
    const configFiles = CONFIG_NAMES.map((name) => join(root, name));
    const tables = checkViewNames(
      withClaims(
        [...merged.values()].map((t) => toSpec(t, !inCode.has(t.name))),
        configFiles,
      ),
    );
    return {
      db: opts.db ? expandPath(opts.db, process.cwd()) : join(root, ".yamlite", "db.sqlite"),
      stateDir: opts.stateDir ? expandPath(opts.stateDir, process.cwd()) : join(root, ".yamlite"),
      tables,
      pages: toPages(raw.pages, root, tables),
    };
  }
  if (!opts.db) throw new Error("either root or db is required");
  const db = expandPath(opts.db, process.cwd());
  return {
    db,
    stateDir: opts.stateDir ? expandPath(opts.stateDir, process.cwd()) : join(dirname(db), ".yamlite"),
    tables: checkViewNames(
      withClaims(
        (opts.tables ?? []).map((t) => toSpec({ ...t, ...locate(`table "${t.name}": `, t, process.cwd()) }, false)),
        [],
      ),
    ),
    pages: [],
  };
}
