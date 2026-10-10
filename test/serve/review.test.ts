import { existsSync } from "node:fs";
import { join } from "node:path";
import { afterEach, beforeEach, expect, test } from "vitest";
import { commit, git, useGitEnv, withRemote } from "../gitrepo.ts";
import { dataRoot, read, sql, waitFor, write } from "../helpers.ts";
import { type Served, startServe } from "./helpers.ts";

let t: Served | undefined;
beforeEach(() => useGitEnv());
afterEach(async () => {
  await t?.s.close();
  t = undefined;
});

const CONFIG = "tables:\n  tasks:\n    columns:\n      title: TEXT\n  people:\n    columns:\n      name: TEXT\n";

async function repoServe(): Promise<{ t: Served; bare: string }> {
  const root = dataRoot();
  write(join(root, "yamlite.yaml"), CONFIG);
  write(join(root, "tasks/a.yaml"), "title: A\n");
  write(join(root, "tasks/b.yaml"), "title: B\n");
  write(join(root, "people.yaml"), "- id: 1\n  name: Alice\n");
  const bare = withRemote(root);
  const t = await startServe({}, undefined, { root, gh: null });
  // serve fills in yamlite.yaml on start; that is not part of what the tests change
  commit(root, "config");
  git(root, "push", "-q");
  return { t, bare };
}

const edit = (t: Served, key: string, from: string, to: string) =>
  t.api(`/api/tables/tasks/rows/${key}`, { method: "PATCH", body: { values: { title: to }, base: { title: from } } });

const gitOf = async (t: Served) => (await t.api("/api/git")).body.git;

test("GET /api/git is null outside a repository, and the other git routes answer 404", async () => {
  t = await startServe({ "tasks/a.yaml": "title: A\n" }, undefined, { gh: null });
  expect(await gitOf(t)).toBeNull();
  const noRepo = { error: "the data folder is not in a git repository" };
  const diff = await t.api("/api/git/diff?path=tasks/a.yaml");
  expect([diff.status, diff.body]).toEqual([404, noRepo]);
  const back = await t.api("/api/git/revert", { method: "POST", body: { records: [{ table: "tasks", key: "a" }] } });
  expect([back.status, back.body]).toEqual([404, noRepo]);
  const review = await t.api("/api/git/review", { method: "POST", body: { title: "T", paths: ["tasks/a.yaml"] } });
  expect(review.status).toBe(404);
});

test("GET /api/git is null without an origin remote", async () => {
  const root = dataRoot();
  write(join(root, "tasks/a.yaml"), "title: A\n");
  git(root, "init", "-q", "-b", "main");
  commit(root, "init");
  t = await startServe({}, undefined, { root, gh: null });
  expect(await gitOf(t)).toBeNull();
});

test("GET /api/git lists changed files with their table and key", async () => {
  ({ t } = await repoServe());
  write(join(t.root, "tasks/c.yaml"), "title: C\n");
  git(t.root, "rm", "-q", "tasks/b.yaml");
  write(join(t.root, "people.yaml"), "- id: 1\n  name: Alicia\n");
  await edit(t, "a", "A", "A2");
  await waitFor(() => read(join(t!.root, "tasks/a.yaml")) === "title: A2\n");
  const body = await gitOf(t);
  expect(body).toMatchObject({ branch: "main", defaultBranch: "main" });
  expect(body.changes).toEqual([
    {
      path: "people.yaml",
      status: "modified",
      table: "people",
      records: [{ key: "1", kind: "modified", fields: ["name"] }],
    },
    {
      path: "tasks/a.yaml",
      status: "modified",
      table: "tasks",
      records: [{ key: "a", kind: "modified", fields: ["title"] }],
    },
    { path: "tasks/b.yaml", status: "deleted", table: "tasks", records: [{ key: "b", kind: "deleted", fields: [] }] },
    { path: "tasks/c.yaml", status: "added", table: "tasks", records: [{ key: "c", kind: "added", fields: [] }] },
  ]);
});

test("review from the default branch creates a branch, commits the chosen files, pushes and links a PR", async () => {
  let bare: string;
  ({ t, bare } = await repoServe());
  git(t.root, "remote", "set-url", "origin", "https://github.com/acme/notes.git");
  git(t.root, "remote", "set-url", "--push", "origin", bare);
  await edit(t, "a", "A", "A2");
  await edit(t, "b", "B", "B2");
  const r = await t.api("/api/git/review", {
    method: "POST",
    body: { title: "Update a", body: "why", paths: ["tasks/a.yaml"] },
  });
  expect(r.status).toBe(200);
  const branch = r.body.branch as string;
  expect(branch).toMatch(/^yamlite\/review-\d{8}-\d{6}$/);
  expect(r.body.results.map((s: { status: string }) => s.status)).toEqual(["done", "done", "done", "done"]);
  expect(r.body.url).toMatch(/^https:\/\/github\.com\/acme\/notes\/compare\/main\.\.\.yamlite%2Freview-/);
  expect(git(bare, "show", `${branch}:tasks/a.yaml`)).toBe("title: A2\n");
  expect(git(bare, "show", `${branch}:tasks/b.yaml`)).toBe("title: B\n");
  expect(git(bare, "log", "-1", "--format=%s", branch).trim()).toBe("Update a");
  const after = await gitOf(t);
  expect(after.branch).toBe(branch);
  expect(after.changes).toEqual([
    {
      path: "tasks/b.yaml",
      status: "modified",
      table: "tasks",
      records: [{ key: "b", kind: "modified", fields: ["title"] }],
    },
  ]);
});

test("review on a pushed branch adds a commit without a new branch", async () => {
  let bare: string;
  ({ t, bare } = await repoServe());
  git(t.root, "switch", "-q", "-c", "work");
  git(t.root, "push", "-q", "-u", "origin", "work");
  await edit(t, "a", "A", "A2");
  const r = await t.api("/api/git/review", {
    method: "POST",
    body: { title: "More", body: "", paths: ["tasks/a.yaml"] },
  });
  expect(r.status).toBe(200);
  expect(r.body.branch).toBe("work");
  expect(r.body.steps).toEqual(["commit", "push", "open_pr"]);
  // a remote that is not on GitHub: pushed, but no PR link
  expect(r.body.results.map((s: { status: string }) => s.status)).toEqual(["done", "done", "failed"]);
  expect(r.body.error).toMatch(/not a GitHub repository/);
  expect(git(bare, "show", "work:tasks/a.yaml")).toBe("title: A2\n");
});

test("review refuses paths outside the data root and empty selections", async () => {
  ({ t } = await repoServe());
  const outside = await t.api("/api/git/review", { method: "POST", body: { title: "x", paths: ["../x.yaml"] } });
  expect(outside.status).toBe(400);
  const none = await t.api("/api/git/review", { method: "POST", body: { title: "x", paths: [] } });
  expect(none.status).toBe(400);
  const untitled = await t.api("/api/git/review", { method: "POST", body: { title: " ", paths: ["tasks/a.yaml"] } });
  expect(untitled.status).toBe(400);
});

test("a review is refused with 409 while other git steps run", async () => {
  ({ t } = await repoServe());
  await edit(t, "a", "A", "A2");
  let release!: () => void;
  const held = t.s.context.proposals.exclusive(() => new Promise<void>((r) => (release = r)));
  const r = await t.api("/api/git/review", { method: "POST", body: { title: "one", paths: ["tasks/a.yaml"] } });
  expect(r.status).toBe(409);
  release();
  await held;
  expect(
    (await t.api("/api/git/review", { method: "POST", body: { title: "one", paths: ["tasks/a.yaml"] } })).status,
  ).toBe(200);
});

test("while a review runs, form writes get 409", async () => {
  ({ t } = await repoServe());
  let release!: () => void;
  const held = t.s.context.proposals.exclusive(() => new Promise<void>((r) => (release = r)));
  expect((await edit(t, "b", "B", "B2")).status).toBe(409);
  release();
  await held;
  expect((await edit(t, "b", "B", "B2")).status).toBe(200);
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
