import { readFileSync } from "node:fs";
import { join } from "node:path";
import { expect, test } from "vitest";
import { parse } from "yaml";
import { resolveConfig, type TableInput } from "../src/config.ts";
import { guide } from "../src/guide.ts";
import { tmpRoot, write } from "./helpers.ts";

const yamlBlocks = (md: string) => [...md.matchAll(/```yaml\n([\s\S]*?)```/g)].map((m) => m[1]!);

test("every yamlite.yaml example in the guide passes config validation", () => {
  const examples = yamlBlocks(guide()).filter((b) => /^tables:/m.test(b));
  expect(examples.length).toBeGreaterThanOrEqual(3);
  for (const example of examples) {
    const root = tmpRoot();
    write(join(root, "yamlite.yaml"), example);
    expect(() => resolveConfig({ root }), example).not.toThrow();
  }
});

// a key added to TableInput fails typecheck here until the guide documents it
const TABLE_KEYS: Record<Exclude<keyof TableInput, "name">, true> = {
  path: true,
  files: true,
  key: true,
  body: true,
  columns: true,
  formats: true,
  indexes: true,
  references: true,
  values: true,
  required: true,
  min: true,
  max: true,
  expand: true,
  group: true,
  split: true,
};

test("the key reference lists every table key", () => {
  const reference = guide().split("## Key reference")[1] ?? "";
  for (const key of Object.keys(TABLE_KEYS)) expect(reference, key).toContain(`| \`${key}\``);
});

test("the skill is installable and points at yamlite guide", () => {
  const text = readFileSync(join(import.meta.dirname, "..", "skills", "yamlite", "SKILL.md"), "utf8");
  const front = parse(text.split("---")[1] ?? "") as { name?: string; description?: string };
  expect(front.name).toBe("yamlite");
  expect(front.description?.length).toBeGreaterThan(0);
  expect(front.description!.length).toBeLessThanOrEqual(1024);
  expect(text).toContain("yamlite guide");
  expect(text).toContain("yamlite check");
});

test("the workflow syncs before the final check, which fails on columns not yet in yamlite.yaml", () => {
  const workflow = guide().split("## Workflow")[1]!.split("\n## ")[0]!;
  expect(workflow).toContain("(not in yamlite.yaml)");
  expect(workflow.indexOf("**Sync**")).toBeGreaterThan(-1);
  expect(workflow.indexOf("**Sync**")).toBeLessThan(workflow.indexOf("**Validate**"));
});

test("the guide's rule constraints match config validation", () => {
  const root = tmpRoot();
  write(join(root, "yamlite.yaml"), "tables:\n  tasks:\n    formats: { due: date }\n    values: { due: [x] }\n");
  expect(() => resolveConfig({ root })).toThrow(/cannot have values/);
  write(join(root, "yamlite.yaml"), "tables:\n  tasks:\n    min: { priority: 1 }\n");
  expect(() => resolveConfig({ root })).toThrow();
  expect(guide()).toContain("`values` on a column with a `formats` entry");
  expect(guide()).toContain("`min` / `max` need the column's type in `columns`");
});
