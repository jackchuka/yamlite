import { rmSync, utimesSync } from "node:fs";
import { join } from "node:path";
import { expect, test } from "vitest";
import { open } from "../src/index.ts";
import { dataRoot, read, sql, tmpRoot, write } from "./helpers.ts";

const dbOf = (root: string) => join(root, ".yamlite", "db.sqlite");

test("discovers and syncs tables", async () => {
  const root = dataRoot();
  write(join(root, "tasks/a.yaml"), "title: A\n");
  write(join(root, "people.yaml"), "- id: p\n  name: P\n");
  const y = await open({ root });
  expect(y.tables.map((t) => t.name)).toEqual(["people", "tasks"]);
  expect((await y.sync()).map((r) => [r.table, r.ok, r.toDb])).toEqual([
    ["people", true, 1],
    ["tasks", true, 1],
  ]);
  await y.close();
});

test("status reports without writing data", async () => {
  const root = dataRoot();
  write(join(root, "tasks/a.yaml"), "title: A\n");
  const y = await open({ root });
  const [s] = await y.status();
  expect(s).toMatchObject({ table: "tasks", toDb: 1, decisions: [{ key: "a", action: "toDb" }] });
  expect(sql(dbOf(root), "SELECT name FROM sqlite_schema WHERE name = 'tasks'")).toEqual([]);
  await y.close();
});

test("deleting the database rebuilds it from YAML without touching files", async () => {
  const root = dataRoot();
  write(join(root, "tasks/a.yaml"), "# keep\ntitle: A\n");
  write(join(root, "tasks/b.yaml"), "title: B\n");
  const y = await open({ root });
  await y.sync();
  await y.close();
  rmSync(join(root, ".yamlite"), { recursive: true, force: true });
  const y2 = await open({ root });
  expect((await y2.sync())[0]).toMatchObject({ toDb: 2, toFile: 0 });
  expect(sql(dbOf(root), "SELECT id FROM tasks ORDER BY id")).toEqual([{ id: "a" }, { id: "b" }]);
  expect(read(join(root, "tasks/a.yaml"))).toBe("# keep\ntitle: A\n");
  await y2.close();
});

// the file is edited, then the row is changed in SQL; the file's mtime decides which of the two is newer
async function conflictWithFileAge(offsetMs: number) {
  const root = dataRoot();
  const file = join(root, "tasks/a.yaml");
  write(file, "title: A\n");
  const y = await open({ root });
  await y.sync();
  write(file, "title: FILE\n");
  sql(dbOf(root), "UPDATE tasks SET title = 'DB' WHERE id = 'a'");
  const at = new Date(Date.now() + offsetMs);
  utimesSync(file, at, at);
  const [planned] = await y.status();
  const [synced] = await y.sync();
  await y.close();
  return { root, file, planned, synced };
}

test("a sync conflict keeps the file when it changed after the database", async () => {
  const { root, file, planned, synced } = await conflictWithFileAge(60_000);
  expect(planned?.conflicts).toMatchObject([{ key: "a", winner: "file" }]);
  expect(synced?.conflicts).toMatchObject([{ key: "a", winner: "file" }]);
  expect(sql(dbOf(root), "SELECT title FROM tasks")).toEqual([{ title: "FILE" }]);
  expect(read(file)).toBe("title: FILE\n");
  expect(read(synced?.conflicts[0]?.savedTo as string)).toMatch(/\ntitle: DB\n$/);
});

test("a sync conflict keeps the database when it changed after the file", async () => {
  const { file, planned, synced } = await conflictWithFileAge(-60_000);
  expect(planned?.conflicts).toMatchObject([{ key: "a", winner: "db" }]);
  expect(synced?.conflicts).toMatchObject([{ key: "a", winner: "db" }]);
  expect(read(file)).toBe("title: DB\n");
  expect(read(synced?.conflicts[0]?.savedTo as string)).toMatch(/\ntitle: FILE\n$/);
});

test("mass deletion is refused unless forced", async () => {
  const root = dataRoot();
  for (let i = 0; i < 12; i++) write(join(root, `tasks/t${i}.yaml`), "x: 1\n");
  const y = await open({ root });
  await y.sync();
  for (let i = 0; i < 12; i++) rmSync(join(root, `tasks/t${i}.yaml`));
  expect((await y.sync())[0]).toMatchObject({ ok: false, error: expect.stringMatching(/refusing/) });
  expect(sql(dbOf(root), "SELECT count(*) AS n FROM tasks")).toEqual([{ n: 12 }]);
  expect((await y.sync({ force: true }))[0]).toMatchObject({ ok: true, deletedDb: 12 });
  await y.close();
});

test("table filter", async () => {
  const root = dataRoot();
  write(join(root, "tasks/a.yaml"), "x: 1\n");
  write(join(root, "people.yaml"), "[]\n");
  const y = await open({ root });
  expect((await y.sync({ tables: ["tasks"] })).map((r) => r.table)).toEqual(["tasks"]);
  await expect(y.sync({ tables: ["nope"] })).rejects.toThrow(/unknown table/);
  await y.close();
});

test("only one process syncs at a time", async () => {
  const root = dataRoot();
  write(join(root, "tasks/a.yaml"), "x: 1\n");
  const a = await open({ root });
  const b = await open({ root });
  await a.sync();
  await expect(b.sync()).rejects.toThrow(/another yamlite process/);
  await expect(b.status()).resolves.toHaveLength(1);
  await a.close();
  await expect(b.sync()).resolves.toHaveLength(1);
  await b.close();
});

test("a stale lock is taken over", async () => {
  const root = dataRoot();
  write(join(root, "tasks/a.yaml"), "x: 1\n");
  write(join(root, ".yamlite/lock"), "999999");
  const y = await open({ root });
  await expect(y.sync()).resolves.toHaveLength(1);
  await y.close();
});

test("lock file contains the pid after acquire and is removed after close", async () => {
  const root = dataRoot();
  write(join(root, "tasks/a.yaml"), "x: 1\n");
  const y = await open({ root });
  await y.sync();
  const lockPath = join(root, ".yamlite", "lock");
  expect(read(lockPath)).toBe(String(process.pid));
  await y.close();
  expect(() => read(lockPath)).toThrow();
});

test("a lock file containing garbage is taken over", async () => {
  const root = dataRoot();
  write(join(root, "tasks/a.yaml"), "x: 1\n");
  write(join(root, ".yamlite/lock"), "abc");
  const y = await open({ root });
  await expect(y.sync()).resolves.toHaveLength(1);
  const lockPath = join(root, ".yamlite", "lock");
  expect(read(lockPath)).toBe(String(process.pid));
  await y.close();
});

test("second close does not throw", async () => {
  const root = dataRoot();
  write(join(root, "tasks/a.yaml"), "x: 1\n");
  const y = await open({ root });
  await y.close();
  await expect(y.close()).resolves.toBeUndefined();
});

test("sync after close rejects with closed message", async () => {
  const root = dataRoot();
  write(join(root, "tasks/a.yaml"), "x: 1\n");
  const y = await open({ root });
  await y.close();
  await expect(y.sync()).rejects.toThrow(/closed/);
});

test("status after close rejects with closed message", async () => {
  const root = dataRoot();
  write(join(root, "tasks/a.yaml"), "x: 1\n");
  const y = await open({ root });
  await y.close();
  await expect(y.status()).rejects.toThrow(/closed/);
});

test("tables passed in code in root mode are not written to yamlite.yaml", async () => {
  const root = dataRoot();
  const outside = tmpRoot();
  write(join(root, "tasks/a.yaml"), "title: A\n");
  write(join(outside, "n.yaml"), "body: hi\n");
  let y = await open({ root, tables: [{ name: "inbox", files: `${outside}/**/*.yaml` }] });
  expect((await y.sync()).map((r) => [r.table, r.ok])).toEqual([
    ["tasks", true],
    ["inbox", true],
  ]);
  expect(read(join(root, "yamlite.yaml"))).toBe("tables:\n  tasks:\n    columns:\n      title: TEXT\n");
  await y.close();
  y = await open({ root });
  expect((await y.sync()).map((r) => [r.table, r.ok, r.error])).toEqual([["tasks", true, undefined]]);
  await y.close();
});

test("a table nested inside another table's folder is not read twice", async () => {
  const root = dataRoot();
  write(join(root, "tasks/a.yaml"), "title: A\n");
  write(join(root, "tasks/archive/old.yaml"), "title: Old\n");
  write(join(root, "yamlite.yaml"), "tables:\n  tasks: {}\n  archive:\n    files: tasks/archive/*.yaml\n");
  const y = await open({ root });
  expect((await y.sync()).every((r) => r.ok)).toBe(true);
  expect(sql(dbOf(root), "SELECT id FROM tasks")).toEqual([{ id: "a" }]);
  expect(sql(dbOf(root), "SELECT id FROM archive")).toEqual([{ id: "old" }]);
  sql(dbOf(root), "DELETE FROM archive WHERE id = 'old'");
  await y.sync();
  expect(sql(dbOf(root), "SELECT id FROM tasks")).toEqual([{ id: "a" }]);
  await y.close();
});

test("a table covering the root syncs every YAML file but yamlite.yaml, and leaves .yamlite alone", async () => {
  const root = dataRoot();
  write(join(root, "yamlite.yaml"), 'tables:\n  docs:\n    files: "**/*.{yaml,yml}"\n');
  write(join(root, "a.yaml"), "title: A\n");
  write(join(root, "sub/b.yml"), "title: B\n");
  const y = await open({ root });
  const [r] = await y.sync();
  expect(r?.ok).toBe(true);
  const config = read(join(root, "yamlite.yaml"));
  const db = join(root, ".yamlite", "db.sqlite");
  expect(sql(db, "SELECT id FROM docs ORDER BY id").map((x) => x.id)).toEqual(["a", "sub/b"]);
  sql(db, "INSERT INTO docs (id, title) VALUES ('yamlite', 'X')");
  const [again] = await y.sync();
  expect(again?.warnings.join("\n")).toContain("key belongs to yamlite.yaml");
  expect(read(join(root, "yamlite.yaml"))).toBe(config);
  await y.close();
});

test("Markdown files are never added to yamlite.yaml on their own", async () => {
  const root = dataRoot();
  write(join(root, "blog/a.md"), "# a\n");
  write(join(root, "tasks/a.yaml"), "title: A\n");
  write(join(root, "tasks/README.md"), "# about\n");
  const y = await open({ root });
  expect((await y.sync()).map((r) => r.table)).toEqual(["tasks"]);
  await y.close();
  expect(read(join(root, "yamlite.yaml"))).not.toMatch(/blog|_md|notes/);
});
