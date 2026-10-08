import { renameSync, unlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { expect, test } from "vitest";
import { open } from "../src/index.ts";
import { dataRoot, read, sql, tmpRoot, waitFor, write } from "./helpers.ts";

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
  const t = await start({}, 'tables:\n  tasks:\n    files: "tasks/**/*.{yaml,yml}"\n');
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

// a complete config, so registration never rewrites yamlite.yaml and triggers a full resync
const tasksConfig = "tables:\n  tasks:\n    columns:\n      title: TEXT\n";

test("edits in nested folders are synced, including folders created later", async () => {
  const t = await start({ "tasks/auto/a.yaml": "title: A\n" }, tasksConfig);
  expect(title(t.db, "auto/a")).toBe("A");
  write(join(t.root, "tasks/auto/a.yaml"), "title: B\n");
  await waitFor(() => title(t.db, "auto/a") === "B");
  write(join(t.root, "tasks/new/deep/b.yaml"), "title: N\n");
  await waitFor(() => title(t.db, "new/deep/b") === "N");
  sql(t.db, "UPDATE tasks SET title = 'C' WHERE id = 'auto/a'");
  await waitFor(() => read(join(t.root, "tasks/auto/a.yaml")) === "title: C\n");
  await t.y.close();
  expect(t.errors).toEqual([]);
});

test("a folder moved into a table is synced", async () => {
  const t = await start({ "tasks/a.yaml": "title: A\n" }, tasksConfig);
  const outside = join(tmpRoot(), "batch");
  write(join(outside, "x.yaml"), "title: X\n");
  write(join(outside, "sub/y.yaml"), "title: Y\n");
  renameSync(outside, join(t.root, "tasks/moved"));
  await waitFor(() => title(t.db, "moved/x") === "X" && title(t.db, "moved/sub/y") === "Y");
  await t.y.close();
  expect(t.errors).toEqual([]);
});

test("a table covering the root picks up edits and does not loop on its own database writes", async () => {
  const root = dataRoot();
  write(join(root, "a.yaml"), "title: A\n");
  write(join(root, "sub/b.yaml"), "title: B\n");
  write(join(root, "yamlite.yaml"), 'tables:\n  docs:\n    files: "**/*.{yaml,yml}"\n');
  const db = join(root, "data.sqlite");
  const y = await open({ root, db });
  const errors: Error[] = [];
  let syncs = 0;
  const w = y.watch({ onError: (e) => errors.push(e), onSync: () => syncs++ }, fast);
  await w.ready;
  const titleOf = (id: string) => sql(db, "SELECT title FROM docs WHERE id = ?", id)[0]?.title;
  // FSEvents can report the writes made just before the watch began, each adding a sync, so
  // count none: a loop on its own writes never lets the syncs go quiet
  let last = syncs;
  let since = Date.now();
  await waitFor(() => {
    if (syncs !== last) [last, since] = [syncs, Date.now()];
    return Date.now() - since >= 500;
  }, 3000);
  write(join(root, "sub/b.yaml"), "title: C\n");
  await waitFor(() => titleOf("sub/b") === "C");
  await y.close();
  expect(errors).toEqual([]);
});

test("a Markdown file added while watching adds no table", async () => {
  const t = await start({ "tasks/a.yaml": "title: A\n" });
  const config = read(join(t.root, "yamlite.yaml"));
  write(join(t.root, "inbox.md"), "# in\n");
  write(join(t.root, "tasks/x.md"), "# x\n");
  write(join(t.root, "tasks/b.yaml"), "title: B\n");
  await waitFor(() => sql(t.db, "SELECT id FROM tasks WHERE id = 'b'").length === 1);
  expect(read(join(t.root, "yamlite.yaml"))).toBe(config);
  await t.y.close();
  expect(t.errors).toEqual([]);
});
