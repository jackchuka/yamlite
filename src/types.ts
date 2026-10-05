export type ColumnType = "INTEGER" | "REAL" | "TEXT" | "BOOLEAN" | "JSON";
export const COLUMN_TYPES: readonly ColumnType[] = ["INTEGER", "REAL", "TEXT", "BOOLEAN", "JSON"];
// how the UI edits a TEXT column, declared under `formats` in yamlite.yaml
export type ColumnFormat = "markdown";
export const COLUMN_FORMATS: readonly ColumnFormat[] = ["markdown"];

export type Mode = "files" | "list";
export type Rec = Record<string, unknown>;
export type DbValue = null | number | bigint | string | Uint8Array;
export type DbRow = Record<string, DbValue>;

// a field named like an Object.prototype member ("constructor", "toString") must not read the inherited one
export const own = <T>(record: Record<string, T>, field: string): T | undefined =>
  Object.hasOwn(record, field) ? record[field] : undefined;

export interface IndexSpec {
  columns?: string[];
  expr?: string;
  unique: boolean;
}

export interface Reference {
  column: string;
  table: string;
  // the referenced column; omitted means the referenced table's key
  target?: string;
}

export interface ExpandSpec {
  // the parent table's column, or below the first level the parent view's element field
  field: string;
  // <parent name>__<field>
  name: string;
  columns: Record<string, ColumnType>;
  formats: Record<string, ColumnFormat>;
  references: Reference[];
  expand: ExpandSpec[];
}

export interface ViewRecord {
  name: string;
  table: string;
  parent: string;
  columns: Record<string, ColumnType>;
  identity: string[];
}

// another table's hold on files inside a files table's folder
export interface Claim {
  // 'table "archive"' or "yamlite.yaml"; quoted in skip reasons and errors
  owner: string;
  // absolute: the claiming table's folder (glob set) or its one file (glob null)
  path: string;
  glob: string | null;
  // same folder as the reading table: a file both match is an error, not a skip
  tie: boolean;
}

export interface TableSpec {
  name: string;
  // files: the folder the glob starts from; list: the one file
  path: string;
  mode: Mode;
  // files: the pattern below path ("**/*.{yaml,yml}"); list: null
  glob: string | null;
  // files tables: how one file maps to a record; list tables are always yaml
  codec: "yaml" | "markdown";
  // markdown tables: the column holding the text below the front matter
  body: string | null;
  key: string;
  columns: Record<string, ColumnType>;
  formats: Record<string, ColumnFormat>;
  indexes: IndexSpec[];
  references: Reference[];
  // whether yamlite.yaml is the schema of record (root mode tables, not the ones passed in code)
  persisted: boolean;
  // files that other tables (and yamlite.yaml) own inside this files table's folder
  exclude: Claim[];
  expand: ExpandSpec[];
  // the sidebar section the table is listed under
  group: string | null;
}

export type PageAccess = "read" | "write";

export interface PageSpec {
  name: string;
  path: string;
  title: string;
  // table or view name → what the page may do with it
  access: Record<string, PageAccess>;
  sql: boolean;
  // origins the page may load from and connect to
  network: string[];
}
