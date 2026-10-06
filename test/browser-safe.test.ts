import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { expect, test } from "vitest";
import { decode } from "../src/value.ts";

const repo = resolve(import.meta.dirname, "..");

// every module the static UI imports from src/, followed through relative imports
function nodeImports(entry: string, seen = new Set<string>()): string[] {
  if (seen.has(entry)) return [];
  seen.add(entry);
  const text = readFileSync(entry, "utf8");
  const found: string[] = [];
  for (const m of text.matchAll(/^(?:import|export)[^;]*?from\s+"([^"]+)"/gms)) {
    const spec = m[1] as string;
    if (spec.startsWith("node:")) found.push(`${entry.slice(repo.length + 1)} → ${spec}`);
    else if (spec.startsWith(".")) found.push(...nodeImports(resolve(dirname(entry), spec), seen));
  }
  return found;
}

test("the modules the static UI shares with the server import nothing from node", () => {
  for (const entry of [
    "src/serve/query.ts",
    "src/serve/wire.ts",
    "src/serve/sqltext.ts",
    "src/serve/errors.ts",
    "src/pages/access.ts",
    "src/datetime.ts",
    "src/rules.ts",
  ]) {
    expect(nodeImports(resolve(repo, entry)), entry).toEqual([]);
  }
});

test("bytes decode to base64 without Buffer", () => {
  expect(decode(new Uint8Array([104, 105]), "TEXT")).toBe("aGk=");
});
