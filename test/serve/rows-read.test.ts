import { afterEach, expect, test } from "vitest";
import { sql } from "../helpers.ts";
import { type Served, startServe } from "./helpers.ts";

let t: Served | undefined;
afterEach(async () => {
  await t?.s.close();
  t = undefined;
});

const tasks = {
  "tasks/a.yaml": "title: Buy milk\ndone: false\npriority: 3\ntags: [home, errand]\n",
  "tasks/a_1.yaml": "title: Call\ndone: true\npriority: 1\ntags: [work]\n",
  "tasks/ab.yaml": "title: Write\ndone: false\npriority: 2\n",
  "tasks/b.yaml": "title: Read\ndone: false\npriority: 5\ntags: [home]\n",
  "tasks/c.yaml": "title: Sleep\ndone: true\npriority: 4\n",
};
const ids = (body: { rows: Array<{ id: string }> }) => body.rows.map((r) => r.id);
const rows = (t: Served, query: string) => t.api(`/api/tables/tasks/rows${query}`);

test("rows are paged in key order with a total", async () => {
  t = await startServe(tasks);
  const { status, body } = await rows(t, "?limit=2&offset=2");
  expect(status).toBe(200);
  expect(body.total).toBe(5);
  expect(ids(body)).toEqual(["ab", "b"]);
});

test("values come back typed", async () => {
  t = await startServe(tasks);
  const { body } = await rows(t, "?limit=1");
  expect(body.rows[0]).toEqual({ id: "a", title: "Buy milk", done: false, priority: 3, tags: ["home", "errand"] });
});

test("sort by a column, then by key", async () => {
  t = await startServe(tasks);
  expect(ids((await rows(t, "?sort=priority:desc")).body)).toEqual(["b", "c", "a", "ab", "a_1"]);
  expect((await rows(t, "?sort=priority:sideways")).status).toBe(400);
  expect((await rows(t, "?sort=nope:asc")).status).toBe(400);
});

test("filters", async () => {
  t = await startServe(tasks);
  const f = (filters: unknown) => rows(t!, `?filter=${encodeURIComponent(JSON.stringify(filters))}`);
  expect(ids((await f([{ col: "done", op: "eq", value: true }])).body)).toEqual(["a_1", "c"]);
  expect(ids((await f([{ col: "tags", op: "has", value: "home" }])).body)).toEqual(["a", "b"]);
  expect(ids((await f([{ col: "title", op: "contains", value: "ea" }])).body)).toEqual(["b"]);
  expect(ids((await f([{ col: "tags", op: "null" }])).body)).toEqual(["ab", "c"]);
  expect(
    ids(
      (
        await f([
          { col: "priority", op: "gte", value: 4 },
          { col: "done", op: "eq", value: false },
        ])
      ).body,
    ),
  ).toEqual(["b"]);
  expect((await f([{ col: "nope", op: "eq", value: 1 }])).status).toBe(400);
  expect((await f([{ col: "title", op: "has", value: "x" }])).status).toBe(400);
  expect((await f([{ col: "title", op: "regex", value: "x" }])).status).toBe(400);
  expect((await rows(t, "?filter=not-json")).status).toBe(400);
});

test("the key prefix is literal, not a LIKE pattern", async () => {
  t = await startServe(tasks);
  expect(ids((await rows(t, "?prefix=a_")).body)).toEqual(["a_1"]);
  expect(ids((await rows(t, "?prefix=a")).body)).toEqual(["a", "a_1", "ab"]);
});

test("big integers keep every digit", async () => {
  t = await startServe({ "tasks/a.yaml": "n: 1\n" });
  sql(t.db, "UPDATE tasks SET n = 9007199254740993 WHERE id = 'a'");
  expect((await rows(t, "")).body.rows[0].n).toBe("9007199254740993");
});

test("one record comes with its file and YAML text", async () => {
  t = await startServe({ "tasks/a.yaml": "# note\ntitle: A\n" });
  const { status, body } = await t.api("/api/tables/tasks/rows/a");
  expect(status).toBe(200);
  expect(body).toEqual({ row: { id: "a", title: "A" }, file: "tasks/a.yaml", yaml: "# note\ntitle: A\n" });
  expect((await t.api("/api/tables/tasks/rows/zzz")).status).toBe(404);
  expect((await t.api("/api/tables/nope/rows")).status).toBe(404);
});

test("a record in a list table points at the list file", async () => {
  t = await startServe({ "people.yaml": "- id: 1\n  name: Al\n" });
  const { body } = await t.api("/api/tables/people/rows/1");
  expect(body.row).toEqual({ id: 1, name: "Al" });
  expect(body.file).toBe("people.yaml");
});

test("a table without a database table yet is empty", async () => {
  t = await startServe({}, "tables:\n  later:\n    path: ./later\n");
  const { status, body } = await t.api("/api/tables/later/rows");
  expect(status).toBe(200);
  expect(body).toEqual({ rows: [], total: 0 });
  const meta = await t.api("/api/meta");
  expect(meta.body.tables.find((x: { name: string }) => x.name === "later")).toMatchObject({ count: 0, inDb: false });
});
