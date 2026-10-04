import { afterEach, expect, test } from "vitest";
import { type Served, startServe } from "./helpers.ts";

let t: Served | undefined;
afterEach(async () => {
  await t?.s.close();
  t = undefined;
});

const CONFIG = `tables:
  projects:
    expand:
      milestones:
        expand:
          tasks: {}
pages:
  board:
    path: b.html
    access: { tasks: read, projects__milestones__tasks: read }
    sql: true
  child:
    path: b.html
    access: { projects__milestones__tasks: read }
    sql: true
  plain:
    path: b.html
    access: { tasks: read }
`;
const FILES = {
  "tasks/a.yaml": "title: A\ntags: [x, y]\n",
  "secret/s.yaml": "token: abc\n",
  "projects/p.yaml": "title: P\nmilestones:\n  - title: M\n    tasks:\n      - title: T\n",
};

async function serve() {
  t = await startServe(FILES, CONFIG);
  const served = t;
  return (sql: string, page = "board") => served.api("/api/sql", { method: "POST", body: { sql, page } });
}

test("a page reads the tables in its access", async () => {
  const ask = await serve();
  expect(await ask("select title from tasks")).toMatchObject({
    status: 200,
    body: { columns: ["title"], rows: [{ title: "A" }], truncated: false },
  });
});

test("table names are matched as SQLite resolves them", async () => {
  const ask = await serve();
  expect((await ask("select title from TASKS")).status).toBe(200);
});

test.each([
  "select * from secret",
  "select * from tasks join secret",
  "select * from tasks where title in (select token from secret)",
  "with x as (select * from secret) select * from x",
  "with tasks as (select * from secret) select * from tasks",
  "explain select * from secret",
])("%s is refused", async (sql) => {
  const ask = await serve();
  expect(await ask(sql)).toEqual({ status: 403, body: { error: "secret is not in this page's access" } });
});

test("a granted view reads through the views and table under it, which stay closed themselves", async () => {
  const ask = await serve();
  expect(await ask("select title from projects__milestones__tasks")).toMatchObject({
    status: 200,
    body: { rows: [{ title: "T" }] },
  });
  expect((await ask("select * from projects__milestones")).body.error).toBe(
    "projects__milestones is not in this page's access",
  );
  expect((await ask("select * from projects")).body.error).toBe("projects is not in this page's access");
});

test("naming a trusted ancestor view that is not in access is refused, a granted child still reads", async () => {
  const ask = await serve();
  const child = (sql: string) => ask(sql, "child");
  const refused = { status: 403, body: { error: "projects__milestones is not in this page's access" } };
  expect(await child("select count(*) from projects__milestones")).toEqual(refused);
  expect(await child("select 1 where (select count(*) from projects__milestones) > 0")).toEqual(refused);
  expect(await child('select count(*) from "projects__milestones"')).toEqual(refused);
  expect(await child("select * from (select * from secret) as projects__milestones")).toEqual(refused);
  expect(await child("select title from projects__milestones__tasks")).toMatchObject({
    status: 200,
    body: { rows: [{ title: "T" }] },
  });
});

test.each([["attach database ':memory:' as x"], ["create table z(a)"], ["pragma table_info(tasks)"]])(
  "%s is refused",
  async (sql) => {
    const ask = await serve();
    expect(await ask(sql)).toEqual({ status: 403, body: { error: "a page can only run SELECT" } });
  },
);

test("a WITH clause cannot stand in for a trusted view", async () => {
  const ask = await serve();
  expect(await ask("with projects__milestones as (select 1) select * from projects__milestones")).toEqual({
    status: 400,
    body: { error: "a WITH clause may not reuse the name of the view projects__milestones" },
  });
});

test("the schema and pragmas are closed, json_each is open", async () => {
  const ask = await serve();
  expect((await ask("select name from sqlite_schema")).body.error).toBe("sqlite_master is not in this page's access");
  expect((await ask("select * from pragma_table_info('tasks')")).status).toBe(403);
  expect(await ask("select value from tasks, json_each(tasks.tags)")).toMatchObject({
    status: 200,
    body: { rows: [{ value: "x" }, { value: "y" }] },
  });
});

test("writes are refused and leave the data alone", async () => {
  const ask = await serve();
  expect(await ask("update tasks set title = 'Z'")).toEqual({
    status: 403,
    body: { error: "a page can only run SELECT" },
  });
  expect((await ask("select title from tasks")).body.rows).toEqual([{ title: "A" }]);
});

test("a WITH that writes is refused and leaves the data alone", async () => {
  const ask = await serve();
  const refused = { status: 403, body: { error: "a page can only run SELECT" } };
  expect(await ask("with x as (select 1) update tasks set title = 'Z'")).toEqual(refused);
  expect(await ask("with x as (select 1) delete from tasks returning *")).toEqual(refused);
  expect((await ask("select title from tasks")).body.rows).toEqual([{ title: "A" }]);
});

test("a page needs sql, and must exist", async () => {
  const ask = await serve();
  expect(await ask("select 1", "plain")).toEqual({ status: 403, body: { error: "page plain may not run SQL" } });
  expect(await ask("select 1", "nope")).toEqual({ status: 404, body: { error: "unknown page: nope" } });
});

test("a refusal does not stick to the next query", async () => {
  const ask = await serve();
  expect((await ask("select * from secret")).status).toBe(403);
  expect((await ask("select count(*) as n from tasks")).body.rows).toEqual([{ n: 1 }]);
});

test("the console without a page still writes", async () => {
  await serve();
  const res = await t!.api("/api/sql", { method: "POST", body: { sql: "update tasks set title = 'Z'" } });
  expect(res.body).toMatchObject({ changes: 1 });
});

test("a real table named like a table function is not opened by that name", async () => {
  const ask = await serve();
  await t!.api("/api/sql", { method: "POST", body: { sql: "create table json_tree(token)" } });
  const refused = { status: 403, body: { error: "json_tree is not in this page's access" } };
  expect(await ask("select * from json_tree")).toEqual(refused);
  expect(await ask("select * from main.JSON_TREE")).toEqual(refused);
  expect((await ask("select value from tasks, json_each(tasks.tags)")).status).toBe(200);
});
