export type ColumnType = "INTEGER" | "REAL" | "TEXT" | "BOOLEAN" | "JSON";
export const COLUMN_TYPES: readonly ColumnType[] = ["INTEGER", "REAL", "TEXT", "BOOLEAN", "JSON"];

export type Mode = "dir" | "list";
export type Rec = Record<string, unknown>;
export type DbValue = null | number | bigint | string | Uint8Array;
export type DbRow = Record<string, DbValue>;

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

export interface TableSpec {
  name: string;
  path: string;
  mode: Mode;
  key: string;
  columns: Record<string, ColumnType>;
  indexes: IndexSpec[];
  references: Reference[];
  // whether yamlite.yaml is the schema of record (root mode tables, not the ones passed in code)
  persisted: boolean;
}
