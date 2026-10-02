import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  realpathSync,
  rmdirSync,
  statSync,
  unlinkSync,
} from "node:fs";
import { dirname, join, resolve, sep } from "node:path";
import { Document, isMap } from "yaml";
import { type FileStamp, sameStamp, stamp, writeAtomic } from "../fsutil.ts";
import { hashContent } from "../hash.ts";
import type { Rec } from "../types.ts";
import { emptyRead, type FileOp, type Source, type SourceApply, type SourceRead } from "./types.ts";
import { parseRecordFile, STRINGIFY_OPTIONS, stripNulls, updateMap, YAML_EXT } from "./yamldoc.ts";

export function invalidKey(key: string): string | null {
  if (key === "") return "empty key cannot be a file name";
  if (/[\\\0]/.test(key)) return "key contains a backslash or NUL";
  if (key.startsWith("/") || key.endsWith("/")) return "key starts or ends with a slash";
  for (const segment of key.split("/")) {
    if (segment === "") return "key has an empty path segment";
    if (segment.startsWith(".")) return "key has a path segment starting with a dot";
    if (segment === "node_modules") return "key has a node_modules path segment";
    if (Buffer.byteLength(segment) + ".yaml".length > 255) return "key is too long for a file name";
  }
  return null;
}

interface RecordFile {
  key: string;
  path: string;
  mtimeMs: number;
}

const skipName = (name: string) => name.startsWith(".") || name === "node_modules";

const lastSegment = (key: string) => key.slice(key.lastIndexOf("/") + 1);

// "a/b/c" → ["a/", "a/b/"]
function prefixes(key: string): string[] {
  const parts = key.split("/").slice(0, -1);
  return parts.map((_, i) => `${parts.slice(0, i + 1).join("/")}/`);
}

// stops at the first folder that is not empty (a dotfile) or cannot be removed
function removeEmptyParents(dir: string, root: string): void {
  for (let d = resolve(dir); d.startsWith(resolve(root) + sep); d = dirname(d)) {
    try {
      rmdirSync(d);
    } catch {
      return;
    }
  }
}

// an entry that cannot be read or stat-ed (a locked folder, a dangling link) throws,
// so the table stops instead of reading its records as deleted
function walk(root: string, warnings: string[]): RecordFile[] {
  const out: RecordFile[] = [];
  const visit = (dir: string, prefix: string, ancestors: ReadonlySet<string>) => {
    for (const name of readdirSync(dir).sort()) {
      if (skipName(name)) continue;
      const path = join(dir, name);
      const st = statSync(path);
      if (st.isDirectory()) {
        const real = realpathSync(path);
        if (ancestors.has(real)) {
          warnings.push(`${path}: symlink loop; skipped`);
          continue;
        }
        visit(path, `${prefix}${name}/`, new Set([...ancestors, real]));
      } else if (st.isFile() && YAML_EXT.test(name)) {
        out.push({ key: prefix + name.replace(YAML_EXT, ""), path, mtimeMs: st.mtimeMs });
      }
    }
  };
  visit(root, "", new Set([realpathSync(root)]));
  return out;
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
    let files: RecordFile[];
    try {
      files = walk(this.dir, res.warnings);
    } catch (e) {
      res.tableError = e instanceof Error ? e.message : String(e);
      return res;
    }
    for (const { key, path, mtimeMs } of files) {
      if (this.paths.has(key)) {
        res.warnings.push(`${path}: another file already uses key "${key}"; skipped`);
        res.records.delete(key);
        res.mtimes.delete(key);
        res.skip.add(key);
        continue;
      }
      this.paths.set(key, path);
      const content = readFileSync(path, "utf8");
      res.stamps.set(path, { mtimeMs, contentHash: hashContent(content) });
      const parsed = parseRecordFile(content);
      if (!parsed.ok) {
        res.warnings.push(`${path}: ${parsed.error}; skipped`);
        res.skip.add(key);
        continue;
      }
      const { [this.keyField]: inFile, ...record } = parsed.record;
      if (inFile !== undefined && inFile !== null && String(inFile) !== key && String(inFile) !== lastSegment(key)) {
        res.warnings.push(`${path}: field "${this.keyField}" differs from the file name; the file name wins`);
      }
      res.records.set(key, record);
      res.mtimes.set(key, mtimeMs);
    }
    return res;
  }

  apply(ops: FileOp[], stamps: Map<string, FileStamp | null>): SourceApply {
    const out: SourceApply = { written: new Map(), skipped: [] };
    if (ops.length === 0) return out;
    mkdirSync(this.dir, { recursive: true });
    const lower = new Map([...this.paths.keys()].map((k) => [k.toLowerCase(), k]));
    const dirs = new Map<string, string>();
    for (const k of this.paths.keys()) for (const p of prefixes(k)) dirs.set(p.toLowerCase(), p);
    for (const op of ops) {
      try {
        const reason = this.applyOne(op, stamps, lower, dirs, out);
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
    dirs: Map<string, string>,
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
    if (!existing) {
      for (const p of prefixes(op.key)) {
        const seen = dirs.get(p.toLowerCase());
        if (seen !== undefined && seen !== p) {
          return `file name clashes with "${seen}" on case-insensitive file systems`;
        }
      }
    }
    const path = existing ?? join(this.dir, `${op.key}.yaml`);
    if (!sameStamp(stamps.get(path) ?? null, stamp(path))) return "file changed during sync; will retry";
    if (op.kind === "delete") {
      if (existsSync(path)) unlinkSync(path);
      removeEmptyParents(dirname(path), this.dir);
      this.paths.delete(op.key);
      lower.delete(op.key.toLowerCase());
      out.written.set(op.key, null);
      return null;
    }
    const parsed = parseRecordFile(this.write(path, op.record));
    const { [this.keyField]: _key, ...record } = parsed.ok ? parsed.record : {};
    this.paths.set(op.key, path);
    lower.set(op.key.toLowerCase(), op.key);
    for (const p of prefixes(op.key)) dirs.set(p.toLowerCase(), p);
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
