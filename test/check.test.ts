import { existsSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { expect, test } from "vitest";
import { check, open } from "../src/index.ts";
import { read, tmpRoot, write } from "./helpers.ts";

function setup(config: string, files: Record<string, string>) {
  const root = tmpRoot();
  write(join(root, "yamlite.yaml"), config);
  for (const [path, content] of Object.entries(files)) write(join(root, path), content);
  return root;
}

const clean = "tables:\n  tasks:\n    columns: { status: TEXT }\n    values:\n      status: [todo, done]\n";

test("no problems: ok, and nothing under root is written", async () => {
  const root = setup(clean, { "tasks/a.yaml": "status: todo\n" });
  const before = read(join(root, "yamlite.yaml"));
  const r = await check({ root });
  expect(r).toEqual({
    ok: true,
    tables: [{ table: "tasks", ok: true, warnings: [], unregistered: [] }],
    unregisteredTables: [],
  });
  expect(existsSync(join(root, ".yamlite"))).toBe(false);
  expect(read(join(root, "yamlite.yaml"))).toBe(before);
  expect(readdirSync(root).sort()).toEqual(["tasks", "yamlite.yaml"]);
});

test("a warning is a problem", async () => {
  const root = setup(clean, { "tasks/a.yaml": "status: doen\n" });
  const r = await check({ root });
  expect(r.ok).toBe(false);
  expect(r.tables[0]?.warnings).toEqual(['status "doen" not in values (a)']);
});

test("a table that fails is a problem", async () => {
  const root = setup("tables:\n  people: {}\n", { "people.yaml": "- [\n" });
  const r = await check({ root });
  expect(r.ok).toBe(false);
  expect(r.tables[0]).toMatchObject({ table: "people", ok: false });
  expect(r.tables[0]?.error).toMatch(/people\.yaml/);
});

test("a column or a table missing from yamlite.yaml is a problem, and yamlite.yaml is left alone", async () => {
  const root = setup(clean, { "tasks/a.yaml": "status: todo\ndue: tomorrow\n", "people.yaml": "- id: 1\n" });
  const before = read(join(root, "yamlite.yaml"));
  const r = await check({ root });
  expect(r.ok).toBe(false);
  expect(r.tables.find((t) => t.table === "tasks")?.unregistered).toEqual([{ column: "due", type: "TEXT" }]);
  expect(r.unregisteredTables).toEqual(["people"]);
  expect(read(join(root, "yamlite.yaml"))).toBe(before);
});

test("--table limits the check", async () => {
  const root = setup(`${clean}  people:\n    columns: { id: INTEGER }\n`, {
    "tasks/a.yaml": "status: doen\n",
    "people.yaml": "- id: 1\n",
  });
  const r = await check({ root, tables: ["people"] });
  expect(r.tables.map((t) => t.table)).toEqual(["people"]);
  expect(r.ok).toBe(true);
});

test("runs while another process holds the lock", async () => {
  const root = setup(clean, { "tasks/a.yaml": "status: todo\n" });
  const y = await open({ root });
  await y.sync();
  const watcher = y.watch();
  await watcher.ready;
  try {
    expect((await check({ root })).ok).toBe(true);
  } finally {
    await y.close();
  }
});

test("a root without yamlite.yaml is an error", async () => {
  const root = tmpRoot();
  await expect(check({ root })).rejects.toThrow(/no yamlite.yaml/);
});
