import { unlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { expect, test } from "vitest";
import { open } from "../src/index.ts";
import { dataRoot, read, sql, waitFor, write } from "./helpers.ts";

const fast = { pollMs: 50, debounceMs: 50 };

async function start(files: Record<string, string>, config?: string) {
  const root = dataRoot();
  for (const [path, content] of Object.entries(files)) write(join(root, path), content);
  if (config) write(join(root, "yamlite.yaml"), config);
  const y = await open({ root });
  const errors: Error[] = [];
  const w = y.watch({ onError: (e) => errors.push(e) }, fast);
  await w.ready;
  return { root, y, errors, db: join(root, ".yamlite", "db.sqlite") };
}

const title = (db: string, id: string) => sql(db, "SELECT title FROM tasks WHERE id = ?", id)[0]?.title;

test("initial sync, file edits and sql writes", async () => {
  const t = await start({ "tasks/a.yaml": "title: A\n" });
  expect(title(t.db, "a")).toBe("A");
  write(join(t.root, "tasks/a.yaml"), "title: B\n");
  await waitFor(() => title(t.db, "a") === "B");
  sql(t.db, "UPDATE tasks SET title = 'C' WHERE id = 'a'");
  await waitFor(() => read(join(t.root, "tasks/a.yaml")) === "title: C\n");
  await t.y.close();
  expect(t.errors).toEqual([]);
});

// Review Focus
test("atomic save (unlink then recreate) ends with the new content", async () => {
  const t = await start({ "tasks/a.yaml": "title: A\n" });
  const file = join(t.root, "tasks/a.yaml");
  unlinkSync(file);
  writeFileSync(file, "title: D\n");
  await waitFor(() => title(t.db, "a") === "D");
  await new Promise((r) => setTimeout(r, 300));
  expect(title(t.db, "a")).toBe("D");
  await t.y.close();
});

test("an atomic save right after ready is never lost", async () => {
  for (let i = 0; i < 5; i++) {
    const t = await start({ "tasks/a.yaml": "title: A\n" });
    const file = join(t.root, "tasks/a.yaml");
    unlinkSync(file);
    writeFileSync(file, "title: D\n");
    await waitFor(() => title(t.db, "a") === "D", 2000);
    await t.y.close();
  }
}, 30000);

test("a table directory created later is watched", async () => {
  const t = await start({}, "tables:\n  tasks:\n    path: ./tasks\n");
  sql(t.db, "CREATE TABLE tasks (id TEXT PRIMARY KEY, title TEXT)");
  sql(t.db, "INSERT INTO tasks VALUES ('x', 'X')");
  await waitFor(() => read(join(t.root, "tasks/x.yaml")) === "title: X\n");
  write(join(t.root, "tasks/x.yaml"), "title: Y\n");
  await waitFor(() => title(t.db, "x") === "Y");
  await t.y.close();
});

test("close stops syncing", async () => {
  const t = await start({ "tasks/a.yaml": "title: A\n" });
  await t.y.close();
  write(join(t.root, "tasks/a.yaml"), "title: Z\n");
  await new Promise((r) => setTimeout(r, 400));
  expect(title(t.db, "a")).toBe("A");
});

test("watch twice throws, and watch after close throws", async () => {
  const t = await start({ "tasks/a.yaml": "title: A\n" });
  expect(() => t.y.watch()).toThrow("already watching");
  await t.y.close();
  expect(() => t.y.watch()).toThrow("yamlite is closed");
});

const managedIndexes = (db: string) =>
  sql(db, "SELECT count(*) AS n FROM sqlite_schema WHERE type = 'index' AND name GLOB 'yamlite_*'")[0]?.n;

test("editing yamlite.yaml while watching applies the new declarations", async () => {
  const t = await start({ "tasks/a.yaml": "title: A\ndone: false\n" });
  const columns = "    columns:\n      title: TEXT\n      done: BOOLEAN\n";
  expect(read(join(t.root, "yamlite.yaml"))).toBe(`tables:\n  tasks:\n${columns}`);
  write(join(t.root, "yamlite.yaml"), `tables:\n  tasks:\n${columns}    indexes:\n      - [done]\n`);
  await waitFor(() => managedIndexes(t.db) === 1);
  write(join(t.root, "yamlite.yaml"), `tables:\n  tasks:\n${columns}    indexes: []\n`);
  await waitFor(() => managedIndexes(t.db) === 0);
  await t.y.close();
  expect(t.errors).toEqual([]);
});

test("a table directory added under the root while watching is picked up", async () => {
  const t = await start({ "tasks/a.yaml": "title: A\n" });
  write(join(t.root, "notes/n.yaml"), "body: hello\n");
  await waitFor(() => sql(t.db, "SELECT body FROM notes WHERE id = 'n'")[0]?.body === "hello");
  expect(t.y.tables.map((x) => x.name)).toEqual(["notes", "tasks"]);
  write(join(t.root, "notes/n.yaml"), "body: changed\n");
  await waitFor(() => sql(t.db, "SELECT body FROM notes WHERE id = 'n'")[0]?.body === "changed");
  await t.y.close();
});

test("a broken yamlite.yaml keeps the previous configuration and reports an error", async () => {
  const t = await start({ "tasks/a.yaml": "title: A\n" });
  write(join(t.root, "yamlite.yaml"), "tables:\n  tasks:\n    columns: { title: DATE }\n");
  await waitFor(() => t.errors.some((e) => /keeping the previous configuration/.test(e.message)));
  write(join(t.root, "tasks/a.yaml"), "title: B\n");
  await waitFor(() => title(t.db, "a") === "B");
  await t.y.close();
});
