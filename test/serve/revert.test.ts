import { existsSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, beforeEach, expect, test } from "vitest";
import { commit, git, useGitEnv, withRemote } from "../gitrepo.ts";
import { dataRoot, read, sql, waitFor, write } from "../helpers.ts";
import { type Served, startServe, waitForAsync } from "./helpers.ts";
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

const revertFiles = (t: Served, files: string[]) => t.api("/api/git/revert", { method: "POST", body: { files } });

test("revert puts a changed file that holds no records back as committed, and reloads yamlite.yaml", async () => {
  ({ t } = await repoServe());
  const committed = read(join(t.root, "yamlite.yaml"));
  write(join(t.root, "yamlite.yaml"), `${committed}  notes:\n    columns:\n      body: TEXT\n`);
  write(join(t.root, ".pages/home.html"), "<p>mine</p>\n");
  await waitFor(() => t!.s.context.y.tables.some((s) => s.name === "notes"));
  const r = await revertFiles(t, ["yamlite.yaml", ".pages/home.html"]);
  expect(r.status).toBe(200);
  expect(r.body).toEqual({ reverted: [], files: ["yamlite.yaml", ".pages/home.html"] });
  expect(read(join(t.root, "yamlite.yaml"))).toBe(committed);
  expect(existsSync(join(t.root, ".pages/home.html"))).toBe(false);
  expect(t.s.context.y.tables.map((s) => s.name)).not.toContain("notes");
  expect((await gitOf(t)).changes).toEqual([]);
});

test("revert brings a deleted file back, and puts records and files back together", async () => {
  ({ t } = await repoServe());
  write(join(t.root, "tasks/a.yaml"), "title: A2\n");
  write(join(t.root, "notes.txt"), "x\n");
  await waitFor(() => sql(t!.db, "SELECT title FROM tasks WHERE id = 'a'")[0]!.title === "A2");
  const committed = read(join(t.root, "yamlite.yaml"));
  rmSync(join(t.root, "yamlite.yaml"));
  await waitForAsync(async () => (await gitOf(t!)).changes.length === 3);
  const r = await t.api("/api/git/revert", {
    method: "POST",
    body: { records: [{ table: "tasks", key: "a" }], files: ["yamlite.yaml", "notes.txt"] },
  });
  expect(r.status).toBe(200);
  expect(r.body.reverted).toEqual([{ table: "tasks", key: "a", before: { title: "A2" }, after: { title: "A" } }]);
  expect(r.body.files).toEqual(["yamlite.yaml", "notes.txt"]);
  expect(read(join(t.root, "yamlite.yaml"))).toBe(committed);
  await waitFor(() => read(join(t!.root, "tasks/a.yaml")) === "title: A\n");
  expect((await gitOf(t)).changes).toEqual([]);
});

test("revert refuses files outside the data folder or without changes, and writes nothing then", async () => {
  ({ t } = await repoServe());
  write(join(t.root, "notes.txt"), "x\n");
  await waitForAsync(async () => (await gitOf(t!)).changes.length === 1);
  for (const files of [["../x.txt"], ["tasks/b.yaml"], ["notes.txt", "missing.txt"], [3]]) {
    const r = await t.api("/api/git/revert", { method: "POST", body: { files } });
    expect(r.status).toBe(400);
  }
  expect((await t.api("/api/git/revert", { method: "POST", body: { files: [] } })).status).toBe(400);
  expect(read(join(t.root, "notes.txt"))).toBe("x\n");
});

test("revert puts a binary file back byte for byte", async () => {
  ({ t } = await repoServe());
  const bytes = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x00, 0xff, 0xfe, 0x80]);
  writeFileSync(join(t.root, "logo.png"), bytes);
  commit(t.root, "logo");
  writeFileSync(join(t.root, "logo.png"), Buffer.from([1, 2, 3]));
  await waitForAsync(async () => (await gitOf(t!)).changes.length === 1);
  expect((await revertFiles(t, ["logo.png"])).status).toBe(200);
  expect(readFileSync(join(t.root, "logo.png"))).toEqual(bytes);
});

test("revert refuses a renamed file instead of removing it, and writes nothing then", async () => {
  ({ t } = await repoServe());
  write(join(t.root, "notes.txt"), "x\n");
  commit(t.root, "notes");
  write(join(t.root, "tasks/a.yaml"), "title: A2\n");
  git(t.root, "mv", "notes.txt", "moved.txt");
  await waitForAsync(async () => (await gitOf(t!)).changes.some((c: { path: string }) => c.path === "moved.txt"));
  const r = await t.api("/api/git/revert", {
    method: "POST",
    body: { records: [{ table: "tasks", key: "a" }], files: ["moved.txt"] },
  });
  expect(r.status).toBe(409);
  expect(read(join(t.root, "moved.txt"))).toBe("x\n");
  expect(read(join(t.root, "tasks/a.yaml"))).toBe("title: A2\n");
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
