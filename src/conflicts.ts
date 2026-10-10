import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { stringify } from "yaml";
import type { Rec } from "./types.ts";

export const DELETED_MARKER = "# deleted on this side";
const HEADER_PREFIX = "# yamlite: ";

export interface ConflictHeader {
  table: string;
  key: string;
  winner: "file" | "db";
  at: string;
  // set when the body is the record's file as it was, at this path below the table folder
  source?: string;
}

export interface ConflictSource {
  file: string;
  text: string;
}

export function saveConflict(
  stateDir: string,
  table: string,
  key: string,
  record: Rec | null,
  winner: "file" | "db",
  { now = new Date(), source }: { now?: Date; source?: ConflictSource } = {},
): string {
  const dir = join(stateDir, "conflicts", table);
  mkdirSync(dir, { recursive: true });
  const safeKey = key.replace(/[^\p{L}\p{N}._-]/gu, "_");
  const stamp = now.toISOString().replaceAll(":", "-");
  // the file name cannot be turned back into the key, so the header carries it
  const header: ConflictHeader = {
    table,
    key,
    winner,
    at: now.toISOString(),
    ...(source && record !== null ? { source: source.file } : {}),
  };
  const body = record === null ? `${DELETED_MARKER}\n` : source ? source.text : stringify(record);
  const content = `${HEADER_PREFIX}${JSON.stringify(header)}\n${body}`;
  for (let n = 0; ; n++) {
    const path = join(dir, `${safeKey}.${stamp}${n === 0 ? "" : `.${n}`}.yaml`);
    try {
      writeFileSync(path, content, { flag: "wx" });
      return path;
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code !== "EEXIST") throw e;
    }
  }
}

export function readConflictHeader(content: string): ConflictHeader | null {
  const first = content.split("\n", 1)[0] ?? "";
  if (!first.startsWith(HEADER_PREFIX)) return null;
  try {
    const h = JSON.parse(first.slice(HEADER_PREFIX.length)) as Partial<ConflictHeader>;
    const valid =
      typeof h.table === "string" &&
      typeof h.key === "string" &&
      (h.winner === "file" || h.winner === "db") &&
      typeof h.at === "string" &&
      (h.source === undefined || typeof h.source === "string");
    return valid ? (h as ConflictHeader) : null;
  } catch {
    return null;
  }
}
