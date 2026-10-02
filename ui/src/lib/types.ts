export type ColumnType = "INTEGER" | "REAL" | "TEXT" | "BOOLEAN" | "JSON";

export interface Reference {
  column: string;
  table: string;
  target?: string;
}

export interface TableMeta {
  name: string;
  mode: "dir" | "list";
  path: string;
  key: string;
  columns: Record<string, ColumnType>;
  references: Reference[];
  count: number;
  inDb: boolean;
}

export interface Meta {
  root: string;
  db: string;
  configFile: string;
  configError: string | null;
  tables: TableMeta[];
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
}

export type ChangeOp = "toDb" | "toFile" | "deleteDb" | "deleteFile";

export interface Change {
  key: string;
  op: ChangeOp;
}

export type ServeEvent =
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
