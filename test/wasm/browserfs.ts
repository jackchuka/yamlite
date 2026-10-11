// node:fs as the browser build has it: src/browser/fs.ts, the tree in memory that src/browser/chokidar.ts watches.
// vitest aliases node:fs here with YAMLITE_FS=browser. "fs" (not "node:fs") still reaches the real disk, to copy
// in what tests read from the repository.
import * as real from "fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import * as fs from "../../src/browser/fs.ts";

const repo = resolve(import.meta.dirname, "../..");
const SKIP = new Set(["node_modules", ".git", "dist", "test-results", ".yamlite"]);

function copy(from: string): void {
  if (real.statSync(from).isDirectory()) {
    fs.mkdirSync(from, { recursive: true });
    for (const name of real.readdirSync(from)) if (!SKIP.has(name)) copy(join(from, name));
  } else {
    fs.mkdirSync(dirname(from), { recursive: true });
    fs.writeFileSync(from, real.readFileSync(from));
  }
}

for (const p of ["package.json", "README.md", "src", "test", "examples"]) {
  if (real.existsSync(join(repo, p))) copy(join(repo, p));
}
fs.mkdirSync(tmpdir(), { recursive: true });
fs.mkdirSync(real.realpathSync(tmpdir()), { recursive: true });

export * from "../../src/browser/fs.ts";
export { default } from "../../src/browser/fs.ts";
