// what the API and its event stream send; Node-free, so the UI can import them
import type { Change, ConflictInfo, Reference, SchemaChange } from "../types.ts";

export type ServeEvent =
  | {
      type: "sync";
      at: string;
      table: string;
      ok: boolean;
      error?: string;
      changes: Change[];
      warnings: string[];
      schema: SchemaChange[];
    }
  | ({ type: "conflict"; at: string } & ConflictInfo)
  | { type: "error"; at: string; table?: string; message: string }
  | { type: "reload"; at: string; tables: string[] }
  | { type: "page"; at: string; pages: string[] };

export interface ConflictEntry {
  id: string;
  table: string;
  file: string;
  key: string | null;
  winner: "file" | "db" | null;
  at: string;
  restorable: boolean;
}

// a reference as /api/meta sends it: key is the referenced column, resolved
export interface MetaReference extends Reference {
  key?: string;
}
