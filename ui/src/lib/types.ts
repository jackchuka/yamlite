export type ColumnType = "INTEGER" | "REAL" | "TEXT" | "BOOLEAN" | "JSON";
export type ColumnFormat = "markdown";
export type AllowedValue = string | number | boolean;

export interface Reference {
  column: string;
  table: string;
  target?: string;
}

export interface TableMeta {
  name: string;
  mode: "files" | "list";
  // files tables: the glob as yamlite.yaml writes it
  files?: string;
  path: string;
  key: string;
  columns: Record<string, ColumnType>;
  formats: Record<string, ColumnFormat>;
  references: Reference[];
  values: Record<string, AllowedValue[]>;
  required: string[];
  count: number;
  inDb: boolean;
  group: string | null;
}

export interface ViewMeta {
  name: string;
  table: string;
  parent: string;
  depth: number;
  columns: Record<string, ColumnType>;
  identity: string[];
  declared: Record<string, ColumnType>;
  references: Reference[];
  values: Record<string, AllowedValue[]>;
  required: string[];
  count: number;
  inDb: boolean;
}

export interface PageMeta {
  name: string;
  title: string;
  path: string;
  access: Record<string, "read" | "write">;
  sql: boolean;
  network: string[];
}

export interface Meta {
  root: string;
  db: string;
  configFile: string;
  configError: string | null;
  tables: TableMeta[];
  views: ViewMeta[];
  pages: PageMeta[];
}

export interface TableSchema {
  name: string;
  mode: "files" | "list";
  // files tables: the glob as yamlite.yaml writes it
  files?: string;
  path: string;
  key: string;
  inDb: boolean;
  columns: Record<string, ColumnType>;
  declared: Record<string, ColumnType>;
  references: Array<{ column: string; table: string; target: string; problems: string[] }>;
  values: Record<string, AllowedValue[]>;
  required: string[];
  indexes: Array<{
    name: string;
    definition: string;
    columns?: string[];
    expr?: string;
    unique: boolean;
    inDb: boolean;
  }>;
  otherIndexes: string[];
  views: Array<{
    name: string;
    parent: string;
    depth: number;
    columns: Record<string, ColumnType>;
    identity: string[];
    inDb: boolean;
    problems: string[];
  }>;
}

export type Row = Record<string, unknown>;

export interface RowsPage {
  rows: Row[];
  total: number;
}

export interface RecordDetail {
  row: Row;
  file: string;
  yaml: string | null;
  yamlError?: string;
}

export interface HistoryChange {
  path: string;
  from: unknown;
  to: unknown;
}

export interface HistoryEntry {
  kind: "wip" | "commit";
  sha: string | null;
  head: boolean;
  subject: string | null;
  author: string | null;
  date: string;
  path: string;
  renamedFrom?: string;
  event?: "created" | "deleted";
  unreadable?: boolean;
  changes: HistoryChange[];
  record: Row | null;
}

export type HistoryPage =
  | { state: "nogit" | "untracked" }
  | { state: "error"; message: string }
  | { state: "ok"; entries: HistoryEntry[]; next: string | null };

export type ChangeOp = "toDb" | "toFile" | "deleteDb" | "deleteFile";

export interface Change {
  key: string;
  op: ChangeOp;
}

export type ServeEvent =
  | { type: "page"; at: string; pages: string[] }
  | {
      type: "sync";
      at: string;
      table: string;
      ok: boolean;
      error?: string;
      changes: Change[];
      warnings: string[];
      schema: unknown[];
    }
  | { type: "conflict"; at: string; table: string; key: string; winner: "file" | "db"; savedTo: string | null }
  | { type: "error"; at: string; table?: string; message: string }
  | { type: "reload"; at: string; tables: string[] };

export interface Hello {
  activity: ServeEvent[];
  warnings: Record<string, string[]>;
  configError: string | null;
}

export interface ConflictEntry {
  id: string;
  table: string;
  file: string;
  key: string | null;
  winner: "file" | "db" | null;
  at: string;
  restorable: boolean;
}

export interface ConflictDetail {
  entry: ConflictEntry;
  deleted: boolean;
  saved: Row | null;
  current: Row | null;
  text: string;
}

export type FilterOp = "eq" | "ne" | "lt" | "lte" | "gt" | "gte" | "contains" | "has" | "null" | "notnull";

export interface Filter {
  col: string;
  op: FilterOp;
  value?: unknown;
}

export type SqlResult =
  | { columns: string[]; rows: Row[]; truncated: boolean; ms: number }
  | { changes: number; ms: number; unmanaged?: string };

export interface Snapshot {
  version: 1;
  generatedAt: string;
  meta: Meta;
  schemas: Record<string, TableSchema>;
  warnings: Record<string, string[]>;
}

// each file's text is stored once: a list table's records all point at the same file
export interface YamlMap {
  files: Record<string, string>;
  keys: Record<string, string>;
}
