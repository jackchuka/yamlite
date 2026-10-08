import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { expect, test } from "vitest";

const repo = resolve(import.meta.dirname, "..");
const BROWSER: Record<string, string> = {
  "node:fs": "src/browser/fs.ts",
  "node:path": "src/browser/path.ts",
  "node:os": "src/browser/os.ts",
  "node:crypto": "src/browser/crypto.ts",
  "node:sqlite": "src/browser/sqlite.ts",
};
// reached only on paths a browser never takes; mapped to unavailable.ts
const UNAVAILABLE = new Set(["node:url", "node:child_process", "node:stream", "node:http", "node:util", "node:module"]);

function imports(entry: string, seen = new Set<string>(), out = new Map<string, Set<string>>()) {
  if (seen.has(entry)) return out;
  seen.add(entry);
  const text = readFileSync(entry, "utf8");
  for (const m of text.matchAll(/^import\s+(?:type\s+)?(?:\{([^}]*)\}|\*\s+as\s+\w+|\w+)?[^;]*?from\s+"([^"]+)"/gms)) {
    const [, names, spec] = m as unknown as [string, string | undefined, string];
    if (spec.startsWith(".")) imports(resolve(dirname(entry), spec), seen, out);
    else if (spec.startsWith("node:") && !m[0].startsWith("import type")) {
      const set = out.get(spec) ?? new Set<string>();
      for (const n of (names ?? "").split(",")) {
        const name = n
          .trim()
          .replace(/^type\s+/, "")
          .split(/\s+as\s+/)[0];
        if (name && !n.trim().startsWith("type ")) set.add(name);
      }
      out.set(spec, set);
    }
  }
  return out;
}

test("every Node API core imports has a browser module that exports it", async () => {
  const used = imports(resolve(repo, "src/serve/workspace.ts"));
  imports(resolve(repo, "src/index.ts"), new Set(), used);
  const missing: string[] = [];
  for (const [spec, names] of used) {
    if (UNAVAILABLE.has(spec)) continue;
    const file = BROWSER[spec];
    if (!file) {
      missing.push(`${spec} (no browser module)`);
      continue;
    }
    const text = readFileSync(resolve(repo, file), "utf8");
    for (const name of names) {
      const exported = new RegExp(
        `export\\s+(?:const|function|class|let|\\*)\\s*${name}\\b|export\\s*\\{[^}]*\\b${name}\\b|export \\* from`,
      ).test(text);
      if (!exported) missing.push(`${spec}.${name}`);
    }
  }
  expect(missing).toEqual([]);
});
