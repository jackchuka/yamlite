import { join } from "node:path";
import { afterEach, expect, test } from "vitest";
import { read, waitFor } from "../helpers.ts";
import { type Served, startServe } from "./helpers.ts";

let t: Served | undefined;
afterEach(async () => {
  await t?.s.close();
  t = undefined;
});

const run = (t: Served, sql: string) => t.api("/api/sql", { method: "POST", body: { sql } });

test("a query returns columns and rows, cut at 1000", async () => {
  t = await startServe({ "tasks/a.yaml": "title: A\n" });
  const small = await run(t, "select id, title from tasks");
  expect(small.status).toBe(200);
  expect(small.body).toMatchObject({ columns: ["id", "title"], rows: [{ id: "a", title: "A" }], truncated: false });
  expect(typeof small.body.ms).toBe("number");
  const big = await run(
    t,
    "with recursive n(i) as (select 1 union all select i + 1 from n where i < 1001) select i from n",
  );
  expect(big.body.rows).toHaveLength(1000);
  expect(big.body.truncated).toBe(true);
});

test("a write goes through the UI connection and reaches the file", async () => {
  t = await startServe({ "tasks/a.yaml": "title: A\n" });
  const res = await run(t, "update tasks set title = 'Z' where id = 'a'");
  expect(res.body).toMatchObject({ changes: 1 });
  await waitFor(() => read(join(t!.root, "tasks/a.yaml")) === "title: Z\n");
});

test("one statement at a time", async () => {
  t = await startServe({ "tasks/a.yaml": "title: A\n" });
  const res = await run(t, "update tasks set title = 'x'; delete from tasks");
  expect(res.status).toBe(400);
  expect(res.body.error).toMatch(/one statement/);
  expect(read(join(t.root, "tasks/a.yaml"))).toBe("title: A\n");
});

test("yamlite's bookkeeping tables can be read but not written", async () => {
  t = await startServe({ "tasks/a.yaml": "title: A\n" });
  expect((await run(t, "select count(*) as n from _yamlite_state")).body.rows).toEqual([{ n: 1 }]);
  const res = await run(t, "delete from _yamlite_state");
  expect(res.status).toBe(400);
  expect(res.body.error).toMatch(/bookkeeping/);
  const views = await run(t, "delete from _yamlite_views");
  expect(views.status).toBe(400);
  expect(views.body.error).toMatch(/_yamlite_views/);
});

test("SQL errors are 400 with SQLite's message", async () => {
  t = await startServe();
  const res = await run(t, "selec 1");
  expect(res.status).toBe(400);
  expect(res.body.error).toMatch(/syntax error/);
  expect((await run(t, "  ")).status).toBe(400);
});

test("a table created in SQL that yamlite.yaml does not list is flagged", async () => {
  t = await startServe();
  expect((await run(t, "create table scratch (id text primary key)")).body).toMatchObject({
    changes: 0,
    unmanaged: "scratch",
  });
});

test("a write is refused while git steps run, a read is not", async () => {
  t = await startServe({ "tasks/a.yaml": "title: A\n" });
  Object.defineProperty(t.s.context.proposals, "running", { get: () => true });
  expect((await run(t, "update tasks set title = 'B'")).status).toBe(409);
  expect((await run(t, "select id from tasks")).status).toBe(200);
});
