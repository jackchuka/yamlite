export type ColumnType = "INTEGER" | "REAL" | "TEXT" | "BOOLEAN" | "JSON";
export const COLUMN_TYPES: readonly ColumnType[] = ["INTEGER", "REAL", "TEXT", "BOOLEAN", "JSON"];
// how the UI edits a TEXT column, declared under `formats` in yamlite.yaml
export type ColumnFormat = "markdown";
export const COLUMN_FORMATS: readonly ColumnFormat[] = ["markdown"];

export type Mode = "dir" | "list";
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

export interface TableSpec {
  name: string;
  path: string;
  mode: Mode;
  key: string;
  columns: Record<string, ColumnType>;
  formats: Record<string, ColumnFormat>;
  indexes: IndexSpec[];
  references: Reference[];
  // whether yamlite.yaml is the schema of record (root mode tables, not the ones passed in code)
  persisted: boolean;
  // paths of other tables inside this directory table's folder; never read or written by it
  exclude: string[];
  expand: ExpandSpec[];
}
