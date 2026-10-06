import { join } from "node:path";
import { afterEach, beforeEach, expect, test } from "vitest";
import { commit, initRepo, useGitEnv } from "../gitrepo.ts";
import { write } from "../helpers.ts";
import { type Served, startServe } from "./helpers.ts";

beforeEach(useGitEnv);
let t: Served | undefined;
afterEach(async () => {
  await t?.s.close();
  t = undefined;
});

const history = (t: Served, table: string, key: string, rest = "") =>
  t.api(`/api/tables/${encodeURIComponent(table)}/rows/${encodeURIComponent(key)}/history${rest}`);

test("history of a record in a directory table, values on the wire", async () => {
  t = await startServe({ "tasks/a.yaml": "title: A\npriority: 1\n" });
  initRepo(t.root);
  commit(t.root, "add a");
  write(join(t.root, "tasks/a.yaml"), "title: A\npriority: 2\n");
  const { status, body } = await history(t, "tasks", "a");
  expect(status).toBe(200);
  expect(body.state).toBe("ok");
  expect(body.entries[0]).toMatchObject({
    kind: "wip",
    path: "tasks/a.yaml",
    changes: [{ path: "priority", from: 1, to: 2 }],
    record: { title: "A", priority: 2 },
  });
  expect(body.entries[1]).toMatchObject({ kind: "commit", subject: "add a", event: "created", path: "tasks/a.yaml" });
});

test("a nested key reaches its file", async () => {
  t = await startServe({ "tasks/archive/b.yaml": "title: B\n" });
  initRepo(t.root);
  commit(t.root, "add b");
  const { body } = await history(t, "tasks", "archive/b");
  expect(body.entries.map((e: { path: string }) => e.path)).toEqual(["tasks/archive/b.yaml"]);
});

test("a list table filters to the record", async () => {
  t = await startServe({ "people.yaml": "- id: 1\n  name: A\n- id: 2\n  name: B\n" });
  initRepo(t.root);
  commit(t.root, "add");
  write(join(t.root, "people.yaml"), "- id: 1\n  name: A\n- id: 2\n  name: C\n");
  commit(t.root, "edit 2");
  const subjects = async (key: string) =>
    (await history(t!, "people", key)).body.entries.map((e: { subject: string }) => e.subject);
  expect(await subjects("1")).toEqual(["add"]);
  expect(await subjects("2")).toEqual(["edit 2", "add"]);
});

test("states and errors", async () => {
  t = await startServe({ "tasks/a.yaml": "title: A\n" });
  expect((await history(t, "tasks", "a")).body).toEqual({ state: "nogit" });
  expect((await history(t, "tasks", "zzz")).status).toBe(404);
  expect((await history(t, "nope", "a")).status).toBe(404);
  expect((await history(t, "tasks", "a", "?cursor=abc")).status).toBe(400);
});

test("diff of a commit and of the uncommitted change", async () => {
  t = await startServe({ "tasks/a.yaml": "title: A\n" });
  initRepo(t.root);
  const sha = commit(t.root, "add a");
  write(join(t.root, "tasks/a.yaml"), "title: B\n");
  const shown = await history(t, "tasks", "a", `/${sha}/diff`);
  expect(shown.status).toBe(200);
  expect(shown.body.text).toContain("+title: A");
  expect((await history(t, "tasks", "a", "/wip/diff")).body.text).toContain("+title: B");
  expect((await history(t, "tasks", "a", "/HEAD/diff")).status).toBe(400);
  expect((await history(t, "tasks", "a", `/${"0".repeat(40)}/diff`)).status).toBe(404);
});
