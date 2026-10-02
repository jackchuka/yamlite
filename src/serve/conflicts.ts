import { existsSync, mkdirSync, readdirSync, readFileSync, renameSync, statSync } from "node:fs";
import { join } from "node:path";
import { parse } from "yaml";
import { DELETED_MARKER, readConflictHeader } from "../conflicts.ts";
import type { Rec } from "../types.ts";
import { HttpError } from "./http.ts";

export interface ConflictEntry {
  id: string;
  table: string;
  file: string;
  key: string | null;
  winner: "file" | "db" | null;
  at: string;
  restorable: boolean;
}

export interface ConflictBackup {
  entry: ConflictEntry;
  deleted: boolean;
  record: Rec | null;
  text: string;
}

const conflictsDir = (stateDir: string) => join(stateDir, "conflicts");

function entryFor(table: string, file: string, text: string, mtime: Date): ConflictEntry {
  const header = readConflictHeader(text);
  return {
    id: `${table}/${file}`,
    table,
    file,
    key: header?.key ?? null,
    winner: header?.winner ?? null,
    at: header?.at ?? mtime.toISOString(),
    restorable: header !== null && header.table === table,
  };
}

export function listConflicts(stateDir: string): ConflictEntry[] {
  const dir = conflictsDir(stateDir);
  if (!existsSync(dir)) return [];
  const out: ConflictEntry[] = [];
  for (const table of readdirSync(dir)) {
    const tableDir = join(dir, table);
    if (!statSync(tableDir).isDirectory()) continue;
    for (const file of readdirSync(tableDir)) {
      const path = join(tableDir, file);
      if (!file.endsWith(".yaml")) continue;
      const st = statSync(path);
      if (!st.isFile()) continue;
      out.push(entryFor(table, file, readFileSync(path, "utf8"), st.mtime));
    }
  }
  return out.sort((a, b) => b.at.localeCompare(a.at));
}

function locate(stateDir: string, id: string): { table: string; file: string; path: string } {
  const parts = id.split("/");
  const [table, file] = parts;
  const valid =
    parts.length === 2 &&
    table !== undefined &&
    file !== undefined &&
    table !== "" &&
    !table.startsWith(".") &&
    !file.startsWith(".") &&
    file.endsWith(".yaml");
  const path = valid ? join(conflictsDir(stateDir), table, file) : "";
  if (!valid || !existsSync(path)) throw new HttpError(404, `unknown conflict: ${id}`);
  return { table, file, path };
}

export function readConflict(stateDir: string, id: string): ConflictBackup {
  const { table, file, path } = locate(stateDir, id);
  const text = readFileSync(path, "utf8");
  const entry = entryFor(table, file, text, statSync(path).mtime);
  const deleted = text.split("\n").includes(DELETED_MARKER);
  const record = deleted ? null : (((parse(text, { intAsBigInt: true }) as Rec | null) ?? {}) as Rec);
  return { entry, deleted, record, text };
}

export function dismissConflict(stateDir: string, id: string): void {
  const { table, file, path } = locate(stateDir, id);
  const dir = join(conflictsDir(stateDir), table, "dismissed");
  mkdirSync(dir, { recursive: true });
  renameSync(path, join(dir, file));
}
