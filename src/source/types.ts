import type { FileStamp } from "../fsutil.ts";
import type { Rec } from "../types.ts";

export interface SourceRead {
  exists: boolean;
  records: Map<string, Rec>;
  mtimes: Map<string, number>;
  skip: Set<string>;
  tableError: string | null;
  warnings: string[];
  stamps: Map<string, FileStamp | null>;
}

export type FileOp = { kind: "put"; key: string; record: Rec } | { kind: "delete"; key: string };

export interface SourceApply {
  written: Map<string, Rec | null>;
  skipped: Array<{ key: string; reason: string }>;
}

export interface Source {
  read(): SourceRead;
  apply(ops: FileOp[], stamps: Map<string, FileStamp | null>): SourceApply;
}

export function emptyRead(): SourceRead {
  return {
    exists: false,
    records: new Map(),
    mtimes: new Map(),
    skip: new Set(),
    tableError: null,
    warnings: [],
    stamps: new Map(),
  };
}
