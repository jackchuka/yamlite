import { join } from "node:path";
import { afterEach, expect, test } from "vitest";
import { sql, waitFor, write } from "../helpers.ts";
import { events, type Served, startServe, waitForAsync } from "./helpers.ts";

let t: Served | undefined;
afterEach(async () => {
  await t?.s.close();
  t = undefined;
});

test("meta lists the tables with columns, counts and relative paths", async () => {
  t = await startServe({ "tasks/a.yaml": "title: A\ndone: false\n", "people.yaml": "- id: 1\n  name: Al\n" });
  const { status, body } = await t.api("/api/meta");
  expect(status).toBe(200);
  expect(body.configError).toBeNull();
  const tasks = body.tables.find((x: { name: string }) => x.name === "tasks");
  expect(tasks).toMatchObject({
    name: "tasks",
    mode: "files",
    path: "tasks",
    key: "id",
    count: 1,
    inDb: true,
    columns: { id: "TEXT", title: "TEXT", done: "BOOLEAN" },
  });
  expect(body.tables.find((x: { name: string }) => x.name === "people")).toMatchObject({
    mode: "list",
    path: "people.yaml",
    count: 1,
  });
});

test("meta marks markdown columns", async () => {
  t = await startServe(
    { "faqs.yaml": "- id: 1\n  answer: hi\n" },
    "tables:\n  faqs:\n    formats: { answer: markdown }\n",
  );
  const { body } = await t.api("/api/meta");
  expect(body.tables[0]).toMatchObject({ columns: { answer: "TEXT" }, formats: { answer: "markdown" } });
});

test("hello carries recent activity, then file edits stream as sync events", async () => {
  t = await startServe({ "tasks/a.yaml": "title: A\n" });
  const ev = await events(t);
  await waitFor(() => ev.got.some((e) => e.type === "hello"));
  write(join(t.root, "tasks/b.yaml"), "title: B\n");
  await waitFor(() =>
    ev.got.some(
      (e) => e.type === "sync" && e.table === "tasks" && e.changes.some((c: { key: string }) => c.key === "b"),
    ),
  );
  await ev.close();
  const again = await events(t);
  await waitFor(() => again.got.some((e) => e.type === "hello"));
  const hello = again.got.find((e) => e.type === "hello");
  expect(hello?.activity.some((a: { type: string; table?: string }) => a.type === "sync" && a.table === "tasks")).toBe(
    true,
  );
  await again.close();
});

test("a database write from another process streams as a sync to the file", async () => {
  t = await startServe({ "tasks/a.yaml": "title: A\n" });
  const ev = await events(t);
  sql(t.db, "UPDATE tasks SET title = 'Z' WHERE id = 'a'");
  await waitFor(() =>
    ev.got.some((e) => e.type === "sync" && e.changes.some((c: { op: string }) => c.op === "toFile")),
  );
  await ev.close();
});

test("syncs that change nothing are not streamed", async () => {
  t = await startServe({ "tasks/a.yaml": "title: A\n" });
  const ev = await events(t);
  await waitFor(() => ev.got.some((e) => e.type === "hello"));
  sql(t.db, "CREATE TABLE scratch (x)");
  await new Promise((r) => setTimeout(r, 400));
  expect(ev.got.filter((e) => e.type === "sync")).toEqual([]);
  await ev.close();
});

test("a broken yamlite.yaml shows up as configError until it is fixed", async () => {
  t = await startServe({ "tasks/a.yaml": "title: A\n" });
  const served = t;
  write(join(t.root, "yamlite.yaml"), "tables: [\n");
  await waitForAsync(async () => (await served.api("/api/meta")).body.configError !== null);
  write(join(t.root, "yamlite.yaml"), "tables: {}\n");
  await waitForAsync(async () => (await served.api("/api/meta")).body.configError === null);
});

test("a repeated sync failure is streamed once, and so is the recovery", async () => {
  t = await startServe({ "tasks/a.yaml": "title: A\n", "people.yaml": "- id: 1\n  name: Al\n" });
  const ev = await events(t);
  await waitFor(() => ev.got.some((e) => e.type === "hello"));
  const failing = () => ev.got.filter((e) => e.type === "sync" && e.table === "people" && !e.ok);
  write(join(t.root, "people.yaml"), "- [\n");
  await waitFor(() => failing().length === 1);
  sql(t.db, "CREATE TABLE scratch1 (x)");
  await new Promise((r) => setTimeout(r, 400));
  sql(t.db, "CREATE TABLE scratch2 (x)");
  await new Promise((r) => setTimeout(r, 400));
  expect(failing()).toHaveLength(1);
  write(join(t.root, "people.yaml"), "- id: 1\n  name: Al\n");
  await waitFor(() => ev.got.some((e) => e.type === "sync" && e.table === "people" && e.ok));
  await ev.close();
});

test("close resolves while an event stream is still connected", async () => {
  t = await startServe({ "tasks/a.yaml": "title: A\n" });
  const ev = await events(t);
  await waitFor(() => ev.got.some((e) => e.type === "hello"));
  const served = t;
  t = undefined;
  await served.s.close();
  await ev.close();
});
