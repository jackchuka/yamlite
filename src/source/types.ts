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
  // a files table's file of each record
  paths: Map<string, string>;
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
    paths: new Map(),
  };
}

// one file ↔ one record, for one file format
export interface Codec {
  // extension of new files
  ext: string;
  // extensions it reads, case-insensitive; stripped from the file name to make the key
  match: RegExp;
  read(content: string): { ok: true; record: Rec } | { ok: false; error: string };
  // keep(field): fields left in the file even when the record lacks them (the key field)
  write(current: string | null, record: Rec, keep: (field: string) => boolean): string;
}
