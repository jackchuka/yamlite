// node:fs backed by memory, as a browser build would have it; vitest aliases node:fs here with YAMLITE_FS=mem.
// "fs" (not "node:fs") still reaches the real disk, to copy in what tests read from the repository.
import * as real from "fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fs as mem } from "memfs";

const repo = resolve(import.meta.dirname, "../..");
const SKIP = new Set(["node_modules", ".git", "dist", "test-results", ".yamlite"]);

function copy(from: string): void {
  const st = real.statSync(from);
  if (st.isDirectory()) {
    mem.mkdirSync(from, { recursive: true });
    for (const name of real.readdirSync(from)) if (!SKIP.has(name)) copy(join(from, name));
  } else {
    mem.mkdirSync(dirname(from), { recursive: true });
    mem.writeFileSync(from, real.readFileSync(from));
  }
}

for (const p of ["package.json", "README.md", "src", "test", "examples"]) {
  if (real.existsSync(join(repo, p))) copy(join(repo, p));
}
mem.mkdirSync(tmpdir(), { recursive: true });
mem.mkdirSync(real.realpathSync(tmpdir()), { recursive: true });

// oxlint-disable-next-line typescript/no-explicit-any
const fs = mem as any;
export const {
  accessSync,
  chmodSync,
  closeSync,
  constants,
  cpSync,
  createReadStream,
  Dirent,
  existsSync,
  fstatSync,
  ftruncateSync,
  linkSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  openSync,
  readdirSync,
  readFileSync,
  readSync,
  realpathSync,
  renameSync,
  rmdirSync,
  rmSync,
  statSync,
  symlinkSync,
  unlinkSync,
  utimesSync,
  watch,
  writeFileSync,
  writeSync,
} = fs;
export default fs;
