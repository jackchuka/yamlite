import { existsSync, readFileSync } from "node:fs";
import { isAbsolute, join, relative, sep } from "node:path";
import { isMap, isSeq, parseDocument } from "yaml";
import { fieldChanges } from "../githistory.ts";
import type { GitDriver } from "../git/driver.ts";
import { claims } from "../source/files.ts";
import { PARSE_OPTIONS } from "../source/yamldoc.ts";
import { own, type Rec, type TableSpec } from "../types.ts";
import { extractor } from "./routes/history.ts";
import { recordFile } from "./routes/rows.ts";

export type RecordKind = "added" | "modified" | "deleted";

export interface RecordChange {
  key: string;
  kind: RecordKind;
  // changed fields, top-level; empty when only the formatting changed or the whole record came or went
  fields: string[];
  // the record at HEAD and in the file now, for showing the change
  before: Rec | null;
  after: Rec | null;
}

export function ownerOf(tables: readonly TableSpec[], file: string): { spec: TableSpec; key: string | null } | null {
  for (const t of tables) {
    if (t.mode === "list") {
      if (t.path === file) return { spec: t, key: null };
      continue;
    }
    if (!claims({ owner: t.name, path: t.path, glob: t.glob, tie: false }, file)) continue;
    if (t.exclude.some((c) => claims(c, file))) continue;
    const rel = relative(t.path, file);
    if (rel.startsWith("..") || isAbsolute(rel)) continue;
    return {
      spec: t,
      key: rel
        .split(sep)
        .join("/")
        .replace(/\.[^./]+$/, ""),
    };
  }
  return null;
}

const currentContent = (root: string, rootPath: string): string | null => {
  const abs = join(root, rootPath);
  return existsSync(abs) ? readFileSync(abs, "utf8") : null;
};

// every record of a list file by key; null when the file cannot be read as a list
function listRecords(spec: TableSpec, content: string | null): Map<string, Rec> | null {
  const out = new Map<string, Rec>();
  if (content === null) return out;
  const doc = parseDocument(content, PARSE_OPTIONS);
  if (doc.errors.length > 0) return null;
  if (doc.contents === null) return out;
  if (!isSeq(doc.contents)) return null;
  for (const item of doc.contents.items) {
    if (!isMap(item)) continue;
    const record = item.toJS(doc) as Rec;
    const key = own(record, spec.key);
    if (key !== null && key !== undefined) out.set(String(key), record);
  }
  return out;
}

function compare(key: string, before: Rec | null, after: Rec | null): RecordChange | null {
  if (before === null && after === null) return null;
  if (before === null) return { key, kind: "added", fields: [], before, after };
  if (after === null) return { key, kind: "deleted", fields: [], before, after };
  const fields = [...new Set(fieldChanges(before, after).map((c) => c.path.split(/[.[]/)[0] as string))];
  return { key, kind: "modified", fields, before, after };
}

// the records a changed file adds, changes or removes; null for files that are not records or cannot be read
export async function recordChanges(
  git: GitDriver,
  root: string,
  tables: readonly TableSpec[],
  rootPath: string,
): Promise<{ table: string; records: RecordChange[] | null } | null> {
  const owner = ownerOf(tables, join(root, rootPath));
  if (!owner) return null;
  const { spec } = owner;
  const [head, now] = [await git.baseContent(rootPath), currentContent(root, rootPath)];
  if (owner.key === null) {
    const [a, b] = [listRecords(spec, head), listRecords(spec, now)];
    if (!a || !b) return { table: spec.name, records: null };
    const records: RecordChange[] = [];
    for (const key of new Set([...a.keys(), ...b.keys()])) {
      const c = compare(key, a.get(key) ?? null, b.get(key) ?? null);
      if (c && (c.kind !== "modified" || c.fields.length > 0)) records.push(c);
    }
    return { table: spec.name, records };
  }
  const extract = extractor(spec, owner.key);
  const [a, b] = [head === null ? null : extract(head), now === null ? null : extract(now)];
  if (a === "unreadable" || b === "unreadable") return { table: spec.name, records: null };
  const c = compare(owner.key, a, b);
  return { table: spec.name, records: c ? [c] : [] };
}

// the record as HEAD has it, without its key; null when HEAD does not have it
export async function headRecord(git: GitDriver, root: string, spec: TableSpec, key: string): Promise<Rec | null> {
  const file = recordFile(spec, key);
  const content = await git.baseContent(relative(root, file));
  if (content === null) return null;
  const found = extractor(spec, key)(content);
  if (found === null) return null;
  if (found === "unreadable") throw new Error(`${relative(root, file)} cannot be read at HEAD`);
  const { [spec.key]: _, ...values } = found;
  return values;
}
