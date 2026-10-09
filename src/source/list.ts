import { existsSync, readFileSync, statSync } from "node:fs";
import { isMap, isSeq, parseDocument, type YAMLMap, type YAMLSeq } from "yaml";
import { type FileStamp, sameStamp, stamp, writeAtomic } from "../fsutil.ts";
import { hashContent } from "../hash.ts";
import type { Rec } from "../types.ts";
import { emptyRead, type FileOp, type Source, type SourceApply, type SourceRead } from "./types.ts";
import { firstError, PARSE_OPTIONS, stringifyOptions, stripNulls, updateMap } from "./yamldoc.ts";

const UNREADABLE = "file could not be read; not modified";

export class ListSource implements Source {
  private skipped = new Set<string>();
  private unreadable = false;

  constructor(
    private readonly file: string,
    private readonly keyField: string,
  ) {}

  read(): SourceRead {
    const res = emptyRead();
    this.skipped = res.skip;
    this.unreadable = false;
    if (!existsSync(this.file)) return res;
    res.exists = true;
    const content = readFileSync(this.file, "utf8");
    const { mtimeMs } = statSync(this.file);
    res.stamps.set(this.file, { mtimeMs, contentHash: hashContent(content) });
    const doc = parseDocument(content, PARSE_OPTIONS);
    if (doc.errors.length > 0) {
      res.tableError = `${this.file}: ${firstError(doc)}`;
      this.unreadable = true;
      return res;
    }
    if (doc.contents === null) return res;
    if (!isSeq(doc.contents)) {
      const hint = isMap(doc.contents)
        ? "; it looks like a single record; run yamlite on the parent directory, or add its directory as a table in yamlite.yaml"
        : "";
      res.tableError = `${this.file}: top-level value must be a sequence${hint}`;
      this.unreadable = true;
      return res;
    }
    for (const [i, item] of doc.contents.items.entries()) {
      if (!isMap(item)) {
        res.warnings.push(`${this.file}[${i}]: not a mapping; ignored`);
        continue;
      }
      const record = item.toJS(doc) as Rec;
      const keyValue = record[this.keyField];
      if (keyValue === null || keyValue === undefined) {
        res.warnings.push(`${this.file}[${i}]: missing "${this.keyField}"; ignored`);
        continue;
      }
      const key = String(keyValue);
      if (res.records.has(key) || res.skip.has(key)) {
        res.records.delete(key);
        res.mtimes.delete(key);
        res.skip.add(key);
        res.warnings.push(`${this.file}[${i}]: duplicate key "${key}"; skipped`);
        continue;
      }
      res.records.set(key, record);
      res.mtimes.set(key, mtimeMs);
    }
    return res;
  }

  apply(ops: FileOp[], stamps: Map<string, FileStamp | null>): SourceApply {
    const out: SourceApply = { written: new Map(), skipped: [] };
    if (ops.length === 0) return out;
    if (this.unreadable) {
      for (const op of ops) out.skipped.push({ key: op.key, reason: UNREADABLE });
      return out;
    }
    if (!sameStamp(stamps.get(this.file) ?? null, stamp(this.file))) {
      for (const op of ops) out.skipped.push({ key: op.key, reason: "file changed during sync; will retry" });
      return out;
    }
    const allowed: FileOp[] = [];
    for (const op of ops) {
      if (this.skipped.has(op.key)) out.skipped.push({ key: op.key, reason: UNREADABLE });
      else allowed.push(op);
    }
    if (allowed.length === 0) return out;
    const source = existsSync(this.file) ? readFileSync(this.file, "utf8") : "";
    const doc = parseDocument(source, PARSE_OPTIONS);
    if (!isSeq(doc.contents)) doc.contents = doc.createNode([]) as typeof doc.contents;
    const seq = doc.contents as unknown as YAMLSeq;
    const keyOf = (item: unknown) => (isMap(item) ? String(item.get(this.keyField)) : undefined);
    for (const op of allowed) {
      const index = seq.items.findIndex((item) => keyOf(item) === op.key);
      if (op.kind === "delete") {
        if (index >= 0) seq.items.splice(index, 1);
        continue;
      }
      if (index >= 0) updateMap(doc, seq.items[index] as YAMLMap, op.record, () => false);
      else seq.items.push(doc.createNode(stripNulls(op.record)));
    }
    writeAtomic(this.file, doc.toString(stringifyOptions(source)));
    const after = this.read();
    for (const op of allowed) {
      if (op.kind === "delete") {
        out.written.set(op.key, null);
        continue;
      }
      const record = after.records.get(op.key);
      if (record) out.written.set(op.key, record);
      else out.skipped.push({ key: op.key, reason: "record not found after write (duplicate key?)" });
    }
    return out;
  }
}
