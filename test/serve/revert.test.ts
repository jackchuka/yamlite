import { existsSync } from "node:fs";
import { join } from "node:path";
import { afterEach, beforeEach, expect, test } from "vitest";
import { commit, useGitEnv, withRemote } from "../gitrepo.ts";
import { dataRoot, read, sql, waitFor, write } from "../helpers.ts";
import { type Served, startServe } from "./helpers.ts";
import { CONFIG, gitOf, repoServe } from "./repo.ts";

let t: Served | undefined;
beforeEach(() => useGitEnv());
afterEach(async () => {
  await t?.s.close();
  t = undefined;
});

const revert = (t: Served, records: Array<{ table: string; key: string; delete?: boolean }>) =>
  t.api("/api/git/revert", { method: "POST", body: { records } });

test("a list file's changes are listed per record, and other files have no records", async () => {
  ({ t } = await repoServe());
  write(join(t.root, "people.yaml"), "- id: 1\n  name: Alice # lead\n- id: 2\n  name: Bob\n");
  write(join(t.root, "notes.txt"), "x\n");
  await waitFor(() => sql(t!.db, "SELECT count(*) AS n FROM people")[0]!.n === 2);
  expect((await gitOf(t)).changes).toEqual([
    { path: "notes.txt", status: "added", table: null, records: null },
    { path: "people.yaml", status: "modified", table: "people", records: [{ key: "2", kind: "added", fields: [] }] },
  ]);
});

test("revert writes the committed values back through the database, keeping the file's comments", async () => {
  ({ t } = await repoServe());
  write(join(t.root, "tasks/a.yaml"), "# mine\ntitle: A2\nnote: extra\n");
  write(join(t.root, "people.yaml"), "- id: 1\n  name: Alicia\n- id: 2\n  name: Bob\n");
  await waitFor(() => sql(t!.db, "SELECT count(*) AS n FROM people")[0]!.n === 2);
  const r = await revert(t, [
    { table: "tasks", key: "a" },
    { table: "people", key: "1" },
  ]);
  expect(r.status).toBe(200);
  expect(r.body.reverted).toEqual([
    { table: "tasks", key: "a", before: { title: "A2", note: "extra" }, after: { title: "A", note: null } },
    { table: "people", key: "1", before: { name: "Alicia" }, after: { name: "Alice" } },
  ]);
  await waitFor(() => read(join(t!.root, "tasks/a.yaml")) === "# mine\ntitle: A\n");
  await waitFor(() => read(join(t!.root, "people.yaml")) === "- id: 1\n  name: Alice\n- id: 2\n  name: Bob\n");
});

test("revert brings a deleted record back, and deletes an added one only when asked to", async () => {
  ({ t } = await repoServe());
  await t.api("/api/tables/tasks/rows/b", { method: "DELETE" });
  await t.api("/api/tables/tasks/rows", { method: "POST", body: { key: "c", values: { title: "C" } } });
  await waitFor(() => existsSync(join(t!.root, "tasks/c.yaml")) && !existsSync(join(t!.root, "tasks/b.yaml")));
  expect((await revert(t, [{ table: "tasks", key: "c" }])).status).toBe(400);
  const r = await revert(t, [
    { table: "tasks", key: "b" },
    { table: "tasks", key: "c", delete: true },
  ]);
  expect(r.status).toBe(200);
  expect(r.body.reverted).toEqual([
    { table: "tasks", key: "b", before: null, after: { title: "B" } },
    { table: "tasks", key: "c", before: { title: "C" }, after: null },
  ]);
  await waitFor(() => existsSync(join(t!.root, "tasks/b.yaml")) && !existsSync(join(t!.root, "tasks/c.yaml")));
  expect(read(join(t.root, "tasks/b.yaml"))).toBe("title: B\n");
});

test("revert brings a deleted file back as committed, comments and styles included", async () => {
  const committed = `# task\ntitle: T\ntags: [x, y]\nnotes: |\n  ${"word ".repeat(20).trim()}\n  second line\n`;
  const root = dataRoot();
  write(join(root, "yamlite.yaml"), CONFIG);
  write(join(root, "tasks/a.yaml"), committed);
  write(join(root, "people.yaml"), "- id: 1\n  name: Alice\n");
  withRemote(root);
  t = await startServe({}, undefined, { root, gh: null });
  commit(root, "config");
  await t.api("/api/tables/tasks/rows/a", { method: "DELETE" });
  await waitFor(() => !existsSync(join(t!.root, "tasks/a.yaml")));
  expect((await revert(t, [{ table: "tasks", key: "a" }])).status).toBe(200);
  await waitFor(() => existsSync(join(t!.root, "tasks/a.yaml")));
  expect(read(join(t.root, "tasks/a.yaml"))).toBe(committed);
  expect((await gitOf(t)).changes).toEqual([]);
  expect((await t.api("/api/conflicts")).body.conflicts).toEqual([]);
});

test("revert brings a deleted .yml file back under its own name", async () => {
  const root = dataRoot();
  write(join(root, "yamlite.yaml"), CONFIG);
  write(join(root, "tasks/a.yml"), "# task\ntitle: A\n");
  write(join(root, "people.yaml"), "- id: 1\n  name: Alice\n");
  withRemote(root);
  t = await startServe({}, undefined, { root, gh: null });
  commit(root, "config");
  await t.api("/api/tables/tasks/rows/a", { method: "DELETE" });
  await waitFor(() => !existsSync(join(t!.root, "tasks/a.yml")));
  expect((await revert(t, [{ table: "tasks", key: "a" }])).status).toBe(200);
  await waitFor(() => existsSync(join(t!.root, "tasks/a.yml")));
  expect(read(join(t.root, "tasks/a.yml"))).toBe("# task\ntitle: A\n");
  expect(existsSync(join(t.root, "tasks/a.yaml"))).toBe(false);
  expect((await gitOf(t)).changes).toEqual([]);
});

test("revert brings a deleted Markdown page back as committed", async () => {
  const page = "---\n# draft\ntitle: Guide\ntags: [a, b]\n---\n\n# Guide\n\nBody text.\n";
  const root = dataRoot();
  write(join(root, "yamlite.yaml"), 'tables:\n  docs:\n    files: "docs/**/*.mdx"\n');
  write(join(root, "docs/guide.mdx"), page);
  withRemote(root);
  t = await startServe({}, undefined, { root, gh: null });
  commit(root, "config");
  await t.api("/api/tables/docs/rows/guide", { method: "DELETE" });
  await waitFor(() => !existsSync(join(t!.root, "docs/guide.mdx")));
  expect((await revert(t, [{ table: "docs", key: "guide" }])).status).toBe(200);
  await waitFor(() => existsSync(join(t!.root, "docs/guide.mdx")));
  expect(read(join(t.root, "docs/guide.mdx"))).toBe(page);
  expect((await gitOf(t)).changes).toEqual([]);
});

test("revert refuses unknown tables, unchanged records and an empty list, and writes nothing then", async () => {
  ({ t } = await repoServe());
  write(join(t.root, "tasks/a.yaml"), "title: A2\n");
  await waitFor(() => sql(t!.db, "SELECT title FROM tasks WHERE id = 'a'")[0]!.title === "A2");
  expect((await revert(t, [])).status).toBe(400);
  expect((await revert(t, [{ table: "nope", key: "a" }])).status).toBe(404);
  const r = await revert(t, [
    { table: "tasks", key: "a" },
    { table: "tasks", key: "b" },
  ]);
  expect(r.status).toBe(400);
  expect(r.body.error).toMatch(/b has no changes/);
  expect(sql(t.db, "SELECT title FROM tasks WHERE id = 'a'")).toEqual([{ title: "A2" }]);
});

test("revert is refused with 409 while git steps run", async () => {
  ({ t } = await repoServe());
  write(join(t.root, "tasks/a.yaml"), "title: A2\n");
  await waitFor(() => sql(t!.db, "SELECT title FROM tasks WHERE id = 'a'")[0]!.title === "A2");
  let release!: () => void;
  const held = t.s.context.proposals.exclusive(() => new Promise<void>((r) => (release = r)));
  expect((await revert(t, [{ table: "tasks", key: "a" }])).status).toBe(409);
  release();
  await held;
});

test("GET /api/git/diff gives each changed record's fields before and after", async () => {
  ({ t } = await repoServe());
  write(join(t.root, "people.yaml"), "- id: 1\n  name: Alicia\n- id: 2\n  name: Bob\n");
  await waitFor(() => sql(t!.db, "SELECT count(*) AS n FROM people")[0]!.n === 2);
  const r = await t.api(`/api/git/diff?path=${encodeURIComponent("people.yaml")}`);
  expect(r.body.records).toEqual([
    { key: "1", kind: "modified", fields: [{ field: "name", from: "Alice", to: "Alicia" }] },
    { key: "2", kind: "added", fields: [{ field: "name", from: null, to: "Bob" }] },
  ]);
  expect((await t.api("/api/git/diff?path=..%2Fx.yaml")).status).toBe(400);
  expect((await t.api("/api/git/diff?path=yamlite.yaml")).status).toBe(404);
});
