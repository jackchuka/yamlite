import { existsSync } from "node:fs";
import { join } from "node:path";
import { afterEach, expect, test } from "vitest";
import { parse } from "yaml";
import { read, sql, waitFor, write } from "../helpers.ts";
import { type Served, startServe } from "./helpers.ts";

let t: Served | undefined;
afterEach(async () => {
  await t?.s.close();
  t = undefined;
});

const file = (t: Served, path: string) => join(t.root, path);
const yamlOf = (t: Served, path: string) => parse(read(file(t, path)), { intAsBigInt: true }) as unknown;
const rowsUrl = (key?: string) => `/api/tables/tasks/rows${key === undefined ? "" : `/${encodeURIComponent(key)}`}`;

test("a new record becomes a new file", async () => {
  t = await startServe({ "tasks/a.yaml": "title: A\n" });
  const res = await t.api(rowsUrl(), {
    method: "POST",
    body: { key: "b", values: { title: "B", done: false, tags: ["x"] } },
  });
  expect(res).toEqual({ status: 201, body: { key: "b" } });
  await waitFor(() => existsSync(file(t!, "tasks/b.yaml")));
  expect(yamlOf(t, "tasks/b.yaml")).toEqual({ title: "B", done: false, tags: ["x"] });
});

test("an update keeps the file's comments", async () => {
  t = await startServe({ "tasks/a.yaml": "# note\ntitle: A # inline\ndone: false\n" });
  const res = await t.api(rowsUrl("a"), { method: "PATCH", body: { values: { done: true }, base: { done: false } } });
  expect(res.status).toBe(200);
  await waitFor(() => read(file(t!, "tasks/a.yaml")) === "# note\ntitle: A # inline\ndone: true\n");
});

test("untouched fields stay byte-identical", async () => {
  const original = "title: A\nmatrix:\n  - {a: [1, 2]}\n  - [x, {b: 2}]\nnote: keep # c\n";
  t = await startServe({ "tasks/a.yaml": original });
  await t.api(rowsUrl("a"), { method: "PATCH", body: { values: { title: "Z" }, base: { title: "A" } } });
  await waitFor(() => read(file(t!, "tasks/a.yaml")) === original.replace("title: A", "title: Z"));
});

test("a stale base is refused with the current values", async () => {
  t = await startServe({ "tasks/a.yaml": "title: A\n" });
  const res = await t.api(rowsUrl("a"), { method: "PATCH", body: { values: { title: "Z" }, base: { title: "old" } } });
  expect(res.status).toBe(409);
  expect(res.body).toMatchObject({ stale: ["title"], current: { id: "a", title: "A" } });
});

test("a file edit while the drawer is open makes the save stale", async () => {
  t = await startServe({ "tasks/a.yaml": "title: A\n" });
  const before = (await t.api(rowsUrl("a"))).body.row;
  write(file(t, "tasks/a.yaml"), "title: B\n");
  await waitFor(() => sql(t!.db, "SELECT title FROM tasks WHERE id = 'a'")[0]?.title === "B");
  const res = await t.api(rowsUrl("a"), {
    method: "PATCH",
    body: { values: { title: "C" }, base: { title: before.title } },
  });
  expect(res.status).toBe(409);
  await new Promise((r) => setTimeout(r, 300));
  expect(read(file(t, "tasks/a.yaml"))).toBe("title: B\n");
});

test("a new field adds a typed column", async () => {
  t = await startServe({ "tasks/a.yaml": "title: A\n" });
  await t.api(rowsUrl("a"), { method: "PATCH", body: { values: { prio: 3 }, base: {} } });
  expect(sql(t.db, "SELECT type FROM pragma_table_info('tasks') WHERE name = 'prio'")).toEqual([{ type: "INTEGER" }]);
  await waitFor(() => read(file(t!, "tasks/a.yaml")) === "title: A\nprio: 3\n");
});

test("setting a field to null removes it from the file", async () => {
  t = await startServe({ "tasks/a.yaml": "title: A\nnote: x\n" });
  await t.api(rowsUrl("a"), { method: "PATCH", body: { values: { note: null }, base: { note: "x" } } });
  await waitFor(() => read(file(t!, "tasks/a.yaml")) === "title: A\n");
});

test("big integers are written exactly", async () => {
  t = await startServe({ "tasks/a.yaml": "n: 1\n" });
  await t.api(rowsUrl("a"), { method: "PATCH", body: { values: { n: "9007199254740993" }, base: { n: 1 } } });
  await waitFor(() => read(file(t!, "tasks/a.yaml")) === "n: 9007199254740993\n");
});

test("keys are validated", async () => {
  t = await startServe({ "tasks/a.yaml": "title: A\n" });
  const post = (body: unknown) => t!.api(rowsUrl(), { method: "POST", body });
  expect(await post({ key: "", values: {} })).toMatchObject({ status: 400, body: { field: "key" } });
  expect(await post({ key: "x/y", values: {} })).toMatchObject({ status: 400, body: { field: "key" } });
  expect(await post({ key: ".hidden", values: {} })).toMatchObject({ status: 400, body: { field: "key" } });
  expect((await post({ key: "a", values: {} })).status).toBe(409);
  expect((await post({ key: "b", values: { id: "c" } })).status).toBe(400);
  expect((await t.api(rowsUrl("a"), { method: "PATCH", body: { values: { id: "z" }, base: {} } })).status).toBe(400);
  expect((await t.api(rowsUrl("zzz"), { method: "PATCH", body: { values: { title: "z" }, base: {} } })).status).toBe(
    404,
  );
});

test("rename moves the file, delete removes it", async () => {
  t = await startServe({ "tasks/a.yaml": "title: A\n", "tasks/b.yaml": "title: B\n" });
  expect((await t.api(`${rowsUrl("a")}/rename`, { method: "POST", body: { to: "b" } })).status).toBe(409);
  expect(await t.api(`${rowsUrl("a")}/rename`, { method: "POST", body: { to: "c" } })).toEqual({
    status: 200,
    body: { key: "c" },
  });
  await waitFor(() => !existsSync(file(t!, "tasks/a.yaml")) && read(file(t!, "tasks/c.yaml")) === "title: A\n");
  expect((await t.api(rowsUrl("c"), { method: "DELETE" })).status).toBe(200);
  await waitFor(() => !existsSync(file(t!, "tasks/c.yaml")));
  expect((await t.api(rowsUrl("c"), { method: "DELETE" })).status).toBe(404);
});

test("keys with URL-special characters", async () => {
  t = await startServe({ "tasks/a.yaml": "title: A\n" });
  const key = "牛乳 #1?%&";
  expect((await t.api(rowsUrl(), { method: "POST", body: { key, values: { title: "M" } } })).status).toBe(201);
  await waitFor(() => existsSync(file(t!, `tasks/${key}.yaml`)));
  expect((await t.api(rowsUrl(key))).body.row).toEqual({ id: key, title: "M" });
  await t.api(rowsUrl(key), { method: "PATCH", body: { values: { title: "N" }, base: { title: "M" } } });
  await waitFor(() => read(file(t!, `tasks/${key}.yaml`)) === "title: N\n");
  await t.api(`${rowsUrl(key)}/rename`, { method: "POST", body: { to: "牛乳 #2" } });
  await waitFor(() => existsSync(file(t!, "tasks/牛乳 #2.yaml")) && !existsSync(file(t!, `tasks/${key}.yaml`)));
  await t.api(rowsUrl("牛乳 #2"), { method: "DELETE" });
  await waitFor(() => !existsSync(file(t!, "tasks/牛乳 #2.yaml")));
});

test("records in a list table", async () => {
  t = await startServe({ "people.yaml": "- id: 1\n  name: Al\n" });
  const people = "/api/tables/people/rows";
  expect((await t.api(people, { method: "POST", body: { key: "", values: { name: "x" } } })).status).toBe(400);
  expect((await t.api(people, { method: "POST", body: { key: "2", values: { name: "Bo" } } })).status).toBe(201);
  await waitFor(() => read(file(t!, "people.yaml")).includes("Bo"));
  expect(yamlOf(t, "people.yaml")).toEqual([
    { id: 1n, name: "Al" },
    { id: 2n, name: "Bo" },
  ]);
});

test("a body that is not an object is refused", async () => {
  t = await startServe({ "tasks/a.yaml": "title: A\n" });
  expect((await t.api(rowsUrl(), { method: "POST", body: [1] })).status).toBe(400);
  expect((await t.api(rowsUrl("a"), { method: "PATCH", body: { values: "x" } })).status).toBe(400);
});
