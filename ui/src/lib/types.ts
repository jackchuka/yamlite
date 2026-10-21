import type { SearchHit } from "../../../src/serve/search.ts";
import type { ConflictEntry, MetaReference, ServeEvent } from "../../../src/serve/types.ts";
import type { AllowedValue, Bound, ColumnFormat, ColumnType } from "../../../src/types.ts";

export type { Filter, FilterOp } from "../../../src/serve/query.ts";
export type { SearchHit } from "../../../src/serve/search.ts";
export type { ConflictEntry, MetaReference, ServeEvent } from "../../../src/serve/types.ts";
export type {
  AllowedValue,
  Bound,
  Change,
  ChangeOp,
  ColumnFormat,
  ColumnType,
  HistoryEntry,
  HistoryPage,
  Reference,
} from "../../../src/types.ts";

export interface SplitItem {
  value: string | number | boolean | null;
  count: number;
}

export interface SplitMeta {
  column: string;
  json: boolean;
  items: SplitItem[];
}

// files tables: a column read from the record's folders, "notes/<team>/*.md" → { column: "team", segment: 0 }
export interface Capture {
  column: string;
  segment: number;
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
  references: MetaReference[];
  values: Record<string, AllowedValue[]>;
  required: string[];
  min: Record<string, Bound>;
  max: Record<string, Bound>;
  count: number;
  inDb: boolean;
  group: string | null;
  split: SplitMeta | null;
  captures: Capture[];
}

export interface ViewMeta {
  name: string;
  table: string;
  parent: string;
  depth: number;
  // the fields from the table's record down to the expanded one
  path: string[];
  columns: Record<string, ColumnType>;
  identity: string[];
  declared: Record<string, ColumnType>;
  references: MetaReference[];
  values: Record<string, AllowedValue[]>;
  required: string[];
  formats: Record<string, ColumnFormat>;
  min: Record<string, Bound>;
  max: Record<string, Bound>;
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
  // absent in a static export
  ai?: { providers: import("./ai").AiProvider[]; viewerKeys: boolean; settingsUrl: string | null } | null;
}

export interface TableSchema {
  // absent in a static export
  base?: string;
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
  formats: Record<string, ColumnFormat>;
  min: Record<string, Bound>;
  max: Record<string, Bound>;
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

export interface Hello {
  activity: ServeEvent[];
  warnings: Record<string, string[]>;
  configError: string | null;
}

export interface ConflictDetail {
  entry: ConflictEntry;
  deleted: boolean;
  saved: Row | null;
  current: Row | null;
  text: string;
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

export interface SearchResult {
  hits: SearchHit[];
}

export interface RuleTarget {
  table: string;
  path: string[];
}

export interface Rules {
  required: string[];
  values: Record<string, AllowedValue[]>;
  formats: Record<string, ColumnFormat>;
  min: Record<string, Bound>;
  max: Record<string, Bound>;
  references: Record<string, string>;
}

export type IndexEdit = { columns: string[]; unique: boolean } | { expr: string; unique: boolean };

// absent fields are left as yamlite.yaml has them
export interface SchemaEdit {
  // the table's complete index list
  indexes?: IndexEdit[];
  // the fields expanded directly under the target
  views?: string[];
}

export interface RulesPreview {
  added: string[];
  removed: string[];
  changed: boolean;
  indexes?: { added: string[]; removed: string[] };
}

export type IndexInfo = TableSchema["indexes"][number];
