// node:fs for the browser build: the working copy is a tree in memory (OPFS directories are async only, and
// yamlite's core is synchronous). Only the calls yamlite's core makes are here.
import { basename, dirname, join, resolve } from "pathe";

type Entry =
  | { kind: "file"; data: Uint8Array; mtimeMs: number; mode: number }
  | { kind: "dir"; mtimeMs: number; mode: number };

const tree = new Map<string, Entry>([
  ["/", { kind: "dir", mtimeMs: Date.now(), mode: 0o755 }],
  ["/tmp", { kind: "dir", mtimeMs: Date.now(), mode: 0o755 }],
]);
const changeHooks = new Set<(event: FsEvent, path: string) => void>();
const removeHooks: Array<(path: string) => void> = [];
const externals: Array<(path: string) => boolean> = [];

export type FsEvent = "add" | "change" | "unlink" | "addDir" | "unlinkDir";

// the browser has no OS watcher: writes through this module are the only changes, so it reports them
export function onChange(fn: (event: FsEvent, path: string) => void): () => void {
  changeHooks.add(fn);
  return () => changeHooks.delete(fn);
}
const emit = (event: FsEvent, path: string) => {
  for (const fn of Array.from(changeHooks)) fn(event, path);
};
const depth = (p: string) => p.split("/").length;
const created = (e: Entry): FsEvent => (e.kind === "dir" ? "addDir" : "add");
const removed = (e: Entry): FsEvent => (e.kind === "dir" ? "unlinkDir" : "unlink");

// deepest first, files before their folder
function emitRemoved(entries: Array<[string, Entry]>): void {
  const order = [...entries].sort(
    ([a, x], [b, y]) =>
      depth(b) - depth(a) || Number(x.kind === "dir") - Number(y.kind === "dir") || (a < b ? -1 : a > b ? 1 : 0),
  );
  for (const [k, e] of order) emit(removed(e), k);
}

// lets the database storage (OPFS) drop files when the folder holding them is removed
export function onRemove(fn: (path: string) => void): void {
  removeHooks.push(fn);
}

// files kept outside this tree (the database in OPFS) still exist for existsSync and statSync
export function external(fn: (path: string) => boolean): void {
  externals.push(fn);
}
const outside = (path: string): Entry | undefined =>
  externals.some((fn) => fn(path))
    ? { kind: "file", data: new Uint8Array(), mtimeMs: Date.now(), mode: 0o644 }
    : undefined;

const abs = (p: string | URL) => resolve(String(p));
const encoder = new TextEncoder();
const decoder = new TextDecoder();

function fail(code: string, what: string, op: string, path: string): never {
  const e = new Error(`${code}: ${what}, ${op} '${path}'`) as Error & { code: string; path: string; syscall: string };
  e.code = code;
  e.path = path;
  e.syscall = op;
  throw e;
}
function noent(op: string, p: string): never {
  return fail("ENOENT", "no such file or directory", op, p);
}

function get(p: string, op: string): Entry {
  return tree.get(p) ?? noent(op, p);
}

function parentDir(p: string, op: string): void {
  const parent = tree.get(dirname(p));
  if (!parent) noent(op, p);
  if (parent.kind !== "dir") fail("ENOTDIR", "not a directory", op, p);
}

function children(p: string): string[] {
  const prefix = p === "/" ? "/" : `${p}/`;
  return [...tree.keys()].filter((k) => k !== p && k.startsWith(prefix) && !k.slice(prefix.length).includes("/"));
}

function stats(e: Entry) {
  return {
    isDirectory: () => e.kind === "dir",
    isFile: () => e.kind === "file",
    isSymbolicLink: () => false,
    mtimeMs: e.mtimeMs,
    mtime: new Date(e.mtimeMs),
    size: e.kind === "file" ? e.data.length : 0,
    mode: (e.kind === "dir" ? 0o040000 : 0o100000) | e.mode,
  };
}

export const constants = { F_OK: 0, R_OK: 4, W_OK: 2, X_OK: 1 };

export const existsSync = (p: string) => tree.has(abs(p)) || outside(abs(p)) !== undefined;

export function statSync(p: string, opts?: { throwIfNoEntry?: boolean }) {
  const e = tree.get(abs(p)) ?? outside(abs(p));
  if (!e) return opts?.throwIfNoEntry === false ? undefined : noent("stat", abs(p));
  return stats(e);
}
export const lstatSync = statSync;

export function accessSync(p: string): void {
  get(abs(p), "access");
}

export function realpathSync(p: string): string {
  get(abs(p), "realpath");
  return abs(p);
}

export function readFileSync(p: string, opts?: string | { encoding?: string }) {
  const path = abs(p);
  const e = get(path, "open");
  if (e.kind === "dir") fail("EISDIR", "illegal operation on a directory", "read", path);
  const enc = typeof opts === "string" ? opts : opts?.encoding;
  return enc ? decoder.decode(e.data) : Buffer.from(e.data);
}

export function writeFileSync(p: string, content: string | Uint8Array, opts?: { flag?: string } | string): void {
  const path = abs(p);
  parentDir(path, "open");
  const existing = tree.get(path);
  if (existing?.kind === "dir") fail("EISDIR", "illegal operation on a directory", "open", path);
  if (existing && typeof opts === "object" && opts.flag === "wx") fail("EEXIST", "file already exists", "open", path);
  const data = typeof content === "string" ? encoder.encode(content) : new Uint8Array(content);
  tree.set(path, { kind: "file", data, mtimeMs: Date.now(), mode: existing?.mode ?? 0o644 });
  emit(existing ? "change" : "add", path);
}

export function mkdirSync(p: string, opts?: { recursive?: boolean }): string | undefined {
  const path = abs(p);
  if (tree.has(path)) {
    if (opts?.recursive && tree.get(path)?.kind === "dir") return undefined;
    fail("EEXIST", "file already exists", "mkdir", path);
  }
  if (opts?.recursive && !tree.has(dirname(path))) mkdirSync(dirname(path), opts);
  parentDir(path, "mkdir");
  tree.set(path, { kind: "dir", mtimeMs: Date.now(), mode: 0o755 });
  emit("addDir", path);
  return path;
}

export function readdirSync(p: string, opts?: { withFileTypes?: boolean }) {
  const path = abs(p);
  const e = get(path, "scandir");
  if (e.kind !== "dir") fail("ENOTDIR", "not a directory", "scandir", path);
  const names = children(path).map((k) => basename(k));
  if (!opts?.withFileTypes) return names;
  return names.map((name) => {
    const s = stats(tree.get(join(path, name)) as Entry);
    return {
      name,
      parentPath: path,
      path,
      isDirectory: s.isDirectory,
      isFile: s.isFile,
      isSymbolicLink: s.isSymbolicLink,
    };
  });
}

function removeTree(path: string): void {
  const gone = [...tree.entries()].filter(([k]) => k === path || k.startsWith(`${path}/`));
  for (const [k] of gone) tree.delete(k);
  emitRemoved(gone);
  for (const fn of removeHooks) fn(path);
}

export function unlinkSync(p: string): void {
  const path = abs(p);
  if (get(path, "unlink").kind === "dir") fail("EISDIR", "illegal operation on a directory", "unlink", path);
  removeTree(path);
}

export function rmdirSync(p: string): void {
  const path = abs(p);
  if (get(path, "rmdir").kind !== "dir") fail("ENOTDIR", "not a directory", "rmdir", path);
  if (children(path).length > 0) fail("ENOTEMPTY", "directory not empty", "rmdir", path);
  removeTree(path);
}

export function rmSync(p: string, opts?: { recursive?: boolean; force?: boolean }): void {
  const path = abs(p);
  const e = tree.get(path);
  if (!e) {
    if (opts?.force) return;
    noent("rm", path);
  }
  if (e.kind === "dir" && !opts?.recursive && children(path).length > 0)
    fail("ENOTEMPTY", "directory not empty", "rm", path);
  removeTree(path);
}

export function renameSync(from: string, to: string): void {
  const a = abs(from);
  const b = abs(to);
  get(a, "rename");
  parentDir(b, "rename");
  const moved = [...tree.entries()].filter(([k]) => k === a || k.startsWith(`${a}/`));
  const replaced = tree.get(b)?.kind === "file";
  for (const [k] of moved) tree.delete(k);
  for (const [k, e] of moved) tree.set(b + k.slice(a.length), e);
  emitRemoved(moved);
  for (const [k, e] of [...moved].sort(([x], [y]) => depth(x) - depth(y))) {
    const dest = b + k.slice(a.length);
    emit(replaced && dest === b && e.kind === "file" ? "change" : created(e), dest);
  }
}

export function linkSync(from: string, to: string): void {
  const a = abs(from);
  const b = abs(to);
  const e = get(a, "link");
  if (tree.has(b)) fail("EEXIST", "file already exists", "link", b);
  parentDir(b, "link");
  tree.set(b, e);
  emit("add", b);
}

export function cpSync(from: string, to: string): void {
  const a = abs(from);
  const b = abs(to);
  const copied: Array<[string, Entry]> = [];
  const replaced = tree.get(b)?.kind === "file";
  for (const [k, e] of Array.from(tree.entries())) {
    if (k === a || k.startsWith(`${a}/`)) {
      const dest = b + k.slice(a.length);
      tree.set(dest, e.kind === "file" ? { ...e, data: e.data.slice() } : { ...e });
      copied.push([dest, e]);
    }
  }
  for (const [k, e] of copied.sort(([x], [y]) => depth(x) - depth(y))) {
    emit(replaced && k === b && e.kind === "file" ? "change" : created(e), k);
  }
}

export function chmodSync(p: string, mode: number): void {
  get(abs(p), "chmod").mode = mode;
}

let tmp = 0;
export function mkdtempSync(prefix: string): string {
  const path = `${abs(prefix)}${(tmp++).toString(36).padStart(6, "0")}`;
  mkdirSync(path);
  return path;
}

export function createReadStream(): never {
  throw new Error("createReadStream is not available in the browser build");
}

export default {
  accessSync,
  chmodSync,
  constants,
  cpSync,
  createReadStream,
  existsSync,
  linkSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  realpathSync,
  renameSync,
  rmdirSync,
  rmSync,
  statSync,
  unlinkSync,
  writeFileSync,
};
