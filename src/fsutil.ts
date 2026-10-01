import {
  chmodSync,
  existsSync,
  mkdirSync,
  readFileSync,
  realpathSync,
  renameSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { basename, dirname, join } from "node:path";
import { hashContent } from "./hash.ts";

export interface FileStamp {
  mtimeMs: number;
  contentHash: string;
}

export function writeAtomic(path: string, content: string): void {
  const exists = existsSync(path);
  // write through symlinks so the link itself is preserved
  const target = exists ? realpathSync(path) : path;
  const dir = dirname(target);
  mkdirSync(dir, { recursive: true });
  const tmp = join(dir, `.${basename(target)}.yamlite-tmp-${process.pid}`);
  const mode = exists ? statSync(target).mode & 0o777 : undefined;
  writeFileSync(tmp, content);
  if (mode !== undefined) chmodSync(tmp, mode);
  renameSync(tmp, target);
}

export function stamp(path: string): FileStamp | null {
  if (!existsSync(path)) return null;
  return { mtimeMs: statSync(path).mtimeMs, contentHash: hashContent(readFileSync(path)) };
}

export function sameStamp(a: FileStamp | null, b: FileStamp | null): boolean {
  if (a === null || b === null) return a === b;
  return a.mtimeMs === b.mtimeMs && a.contentHash === b.contentHash;
}
