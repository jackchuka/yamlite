import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, unlinkSync } from "node:fs";
import { join } from "node:path";
import { Document, isMap } from "yaml";
import { type FileStamp, sameStamp, stamp, writeAtomic } from "../fsutil.ts";
import { hashContent } from "../hash.ts";
import type { Rec } from "../types.ts";
import { emptyRead, type FileOp, type Source, type SourceApply, type SourceRead } from "./types.ts";
import { parseRecordFile, STRINGIFY_OPTIONS, stripNulls, updateMap, YAML_EXT } from "./yamldoc.ts";

export function invalidKey(key: string): string | null {
  if (key === "") return "empty key cannot be a file name";
  if (/[/\\\0]/.test(key)) return "key contains a path separator or NUL";
  if (key.startsWith(".")) return "key starts with a dot";
  if (Buffer.byteLength(key) + ".yaml".length > 255) return "key is too long for a file name";
  return null;
}

export class DirSource implements Source {
  private paths = new Map<string, string>();
  private skipped = new Set<string>();

  constructor(
    private readonly dir: string,
    private readonly keyField: string,
  ) {}

  read(): SourceRead {
    const res = emptyRead();
    this.paths = new Map();
    this.skipped = res.skip;
    if (!existsSync(this.dir)) return res;
    res.exists = true;
    for (const name of readdirSync(this.dir).sort()) {
      if (name.startsWith(".") || !YAML_EXT.test(name)) continue;
      const path = join(this.dir, name);
      const st = statSync(path);
      if (!st.isFile()) continue;
      const key = name.replace(YAML_EXT, "");
      if (this.paths.has(key)) {
        res.warnings.push(`${path}: another file already uses key "${key}"; skipped`);
        res.records.delete(key);
        res.mtimes.delete(key);
        res.skip.add(key);
        continue;
      }
      this.paths.set(key, path);
      const content = readFileSync(path, "utf8");
      res.stamps.set(path, { mtimeMs: st.mtimeMs, contentHash: hashContent(content) });
      const parsed = parseRecordFile(content);
      if (!parsed.ok) {
        res.warnings.push(`${path}: ${parsed.error}; skipped`);
        res.skip.add(key);
        continue;
      }
      const { [this.keyField]: inFile, ...record } = parsed.record;
      if (inFile !== undefined && inFile !== null && String(inFile) !== key) {
        res.warnings.push(`${path}: field "${this.keyField}" differs from the file name; the file name wins`);
      }
      res.records.set(key, record);
      res.mtimes.set(key, st.mtimeMs);
    }
    return res;
  }

  apply(ops: FileOp[], stamps: Map<string, FileStamp | null>): SourceApply {
    const out: SourceApply = { written: new Map(), skipped: [] };
    if (ops.length === 0) return out;
    mkdirSync(this.dir, { recursive: true });
    const lower = new Map([...this.paths.keys()].map((k) => [k.toLowerCase(), k]));
    for (const op of ops) {
      try {
        const reason = this.applyOne(op, stamps, lower, out);
        if (reason) out.skipped.push({ key: op.key, reason });
      } catch (e) {
        out.skipped.push({ key: op.key, reason: e instanceof Error ? e.message : String(e) });
      }
    }
    return out;
  }

  private applyOne(
    op: FileOp,
    stamps: Map<string, FileStamp | null>,
    lower: Map<string, string>,
    out: SourceApply,
  ): string | null {
    const invalid = invalidKey(op.key);
    if (invalid) return invalid;
    if (this.skipped.has(op.key)) return "file could not be read; not modified";
    const existing = this.paths.get(op.key);
    const clash = lower.get(op.key.toLowerCase());
    if (!existing && clash !== undefined && clash !== op.key) {
      return `file name clashes with "${clash}" on case-insensitive file systems`;
    }
    const path = existing ?? join(this.dir, `${op.key}.yaml`);
    if (!sameStamp(stamps.get(path) ?? null, stamp(path))) return "file changed during sync; will retry";
    if (op.kind === "delete") {
      if (existsSync(path)) unlinkSync(path);
      this.paths.delete(op.key);
      lower.delete(op.key.toLowerCase());
      out.written.set(op.key, null);
      return null;
    }
    const parsed = parseRecordFile(this.write(path, op.record));
    const { [this.keyField]: _key, ...record } = parsed.ok ? parsed.record : {};
    this.paths.set(op.key, path);
    lower.set(op.key.toLowerCase(), op.key);
    out.written.set(op.key, record);
    return null;
  }

  private write(path: string, record: Rec): string {
    const current = existsSync(path) ? parseRecordFile(readFileSync(path, "utf8")) : null;
    let doc: Document;
    if (current?.ok && isMap(current.doc.contents)) {
      doc = current.doc;
      updateMap(doc, current.doc.contents, record, (field) => field === this.keyField);
    } else {
      doc = new Document(stripNulls(record));
    }
    const content = doc.toString(STRINGIFY_OPTIONS);
    writeAtomic(path, content);
    return content;
  }
}
