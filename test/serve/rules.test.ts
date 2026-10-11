import { join } from "node:path";
import { afterEach, expect, test } from "vitest";
import { read, write } from "../helpers.ts";
import { type Served, startServe, waitForAsync } from "./helpers.ts";

let t: Served | undefined;
afterEach(async () => {
  await t?.s.close();
  t = undefined;
});

const none = { required: [], values: {}, formats: {}, min: {}, max: {}, references: {} };
const config = "tables:\n  tasks: # work\n    key: id\n";
const files = {
  "tasks/a.yaml": "title: A\nstatus: todo\n",
  "tasks/b.yaml": "status: wip\n",
};
let initial = "";
const start = async () => {
  const served = await startServe(files, config);
  initial = read(join(served.root, "yamlite.yaml"));
  return served;
};
const base = async (t: Served) => (await t.api("/api/tables/tasks/schema")).body.base as string;
const send = (t: Served, method: "POST" | "PUT", body: unknown) =>
  t.api(method === "POST" ? "/api/rules/preview" : "/api/rules", { method, body });

test("a preview lists the warnings a change adds and writes nothing", async () => {
  t = await start();
  const res = await send(t, "POST", {
    target: { table: "tasks", path: [] },
    rules: { ...none, required: ["title"], values: { status: ["todo", "done"] } },
    base: await base(t),
  });
  expect(res.status).toBe(200);
  expect(res.body.changed).toBe(true);
  expect(res.body.removed).toEqual([]);
  expect(res.body.added).toEqual(
    expect.arrayContaining([expect.stringContaining("title missing (b)"), expect.stringContaining('"wip"')]),
  );
  expect(read(join(t.root, "yamlite.yaml"))).toBe(initial);
});

test("saving writes yamlite.yaml and the new rules apply at once", async () => {
  t = await start();
  const res = await send(t, "PUT", {
    target: { table: "tasks", path: [] },
    rules: { ...none, required: ["title"] },
    base: await base(t),
  });
  expect(res.status).toBe(200);
  expect(read(join(t.root, "yamlite.yaml"))).toBe(`${initial}    required: [title]\n`);
  const schema = (await t.api("/api/tables/tasks/schema")).body;
  expect(schema.required).toEqual(["title"]);
  expect(schema.base).toBe(res.body.base);
});

test("a stale base is refused", async () => {
  t = await start();
  const stale = await base(t);
  write(join(t.root, "yamlite.yaml"), "tables:\n  tasks:\n    key: id\n    group: Work\n");
  const res = await send(t, "PUT", { target: { table: "tasks", path: [] }, rules: none, base: stale });
  expect(res.status).toBe(409);
  expect(res.body.current).not.toBe(stale);
});

test("invalid rules and unknown targets are refused", async () => {
  t = await start();
  const b = await base(t);
  const target = { table: "tasks", path: [] };
  expect((await send(t, "POST", { target, rules: { ...none, max: { title: 3 } }, base: b })).status).toBe(400);
  expect(
    (await send(t, "POST", { target, rules: { ...none, references: { owner: "not a ref" } }, base: b })).status,
  ).toBe(400);
  expect(await send(t, "POST", { target, rules: { required: "title" }, base: b })).toMatchObject({
    status: 400,
    body: { field: "rules" },
  });
  expect((await send(t, "POST", { target: { table: "nope", path: [] }, rules: none, base: b })).status).toBe(404);
});

test("an unchanged rule set does not write", async () => {
  t = await start();
  const res = await send(t, "PUT", { target: { table: "tasks", path: [] }, rules: none, base: await base(t) });
  expect(res.body).toMatchObject({ changed: false, added: [], removed: [] });
  expect(read(join(t.root, "yamlite.yaml"))).toBe(initial);
});

test("saving is refused while git steps run, without a current base", async () => {
  t = await start();
  Object.defineProperty(t.s.context.proposals, "running", { get: () => true });
  const res = await send(t, "PUT", {
    target: { table: "tasks", path: [] },
    rules: { ...none, required: ["title"] },
    base: await base(t),
  });
  expect(res.status).toBe(409);
  expect(res.body.current).toBeUndefined();
  expect(read(join(t.root, "yamlite.yaml"))).toBe(initial);
});

test("a Markdown table's implied body format is not written on save", async () => {
  t = await startServe({ "notes/a.md": "---\ntitle: A\n---\nHello\n" }, 'tables:\n  notes:\n    files: "notes/*.md"\n');
  const text = read(join(t.root, "yamlite.yaml"));
  const schema = (await t.api("/api/tables/notes/schema")).body;
  expect(schema.formats).toEqual({ body: "markdown" });
  const res = await send(t, "PUT", {
    target: { table: "notes", path: [] },
    rules: { ...none, formats: schema.formats },
    base: schema.base,
  });
  expect(res.body).toMatchObject({ changed: false, added: [], removed: [] });
  expect(read(join(t.root, "yamlite.yaml"))).toBe(text);
});

test("a view's rules are previewed with the view's warnings, and an unknown view is refused", async () => {
  t = await startServe(
    {
      "people.yaml": "- id: ann\n",
      "projects/website.yaml": "milestones:\n  - title: Design\n    owner: ann\n",
      "projects/blog.yaml": "milestones:\n  - title: Draft\n",
    },
    "tables:\n  projects:\n    expand:\n      milestones:\n        columns: { title: TEXT, owner: TEXT }\n        required: [title]\n  people:\n    path: ./people.yaml\n",
  );
  await waitForAsync(async () => (await t?.api("/api/meta"))?.body.views?.[0]?.inDb === true);
  const b = (await t.api("/api/tables/projects/schema")).body.base as string;
  const res = await send(t, "POST", {
    target: { table: "projects", path: ["milestones"] },
    rules: { ...none, required: ["title", "owner"] },
    base: b,
  });
  expect(res.status).toBe(200);
  expect(res.body).toMatchObject({ changed: true, removed: [] });
  expect(res.body.added).toEqual([expect.stringMatching(/^projects__milestones: owner missing \(/)]);
  const bad = await send(t, "POST", { target: { table: "projects", path: ["nope"] }, rules: none, base: b });
  expect(bad.status).toBe(404);
});

const tasksTarget = { table: "tasks", path: [] };
const indexNames = (t: Served) =>
  t.s.context.store
    .query("SELECT name FROM sqlite_schema WHERE type = 'index' AND tbl_name = 'tasks' AND name LIKE 'yamlite_%'")
    .map((r) => r.name);

test("a preview lists the indexes a change adds and writes nothing", async () => {
  t = await start();
  const res = await send(t, "POST", {
    target: tasksTarget,
    rules: none,
    indexes: [{ columns: ["status"], unique: false }],
    base: await base(t),
  });
  expect(res.status).toBe(200);
  expect(res.body).toMatchObject({ changed: true, indexes: { added: ["(status)"], removed: [] } });
  expect(read(join(t.root, "yamlite.yaml"))).toBe(initial);
});

test("saving an index creates it in the database", async () => {
  t = await start();
  await waitForAsync(async () => (await t?.api("/api/tables/tasks/rows"))?.status === 200);
  const res = await send(t, "PUT", {
    target: tasksTarget,
    rules: none,
    indexes: [{ columns: ["status"], unique: false }],
    base: await base(t),
  });
  expect(res.status).toBe(200);
  expect(read(join(t.root, "yamlite.yaml"))).toBe(`${initial}    indexes:\n      - [status]\n`);
  const served = t;
  await waitForAsync(async () => indexNames(served).length === 1);
  const removed = await send(t, "POST", { target: tasksTarget, rules: none, indexes: [], base: res.body.base });
  expect(removed.body.indexes).toEqual({ added: [], removed: ["(status)"] });
});

test("a preview warns about a view that cannot be built", async () => {
  t = await start();
  const res = await send(t, "POST", { target: tasksTarget, rules: none, views: ["title"], base: await base(t) });
  expect(res.status).toBe(200);
  expect(res.body.changed).toBe(true);
  expect(res.body.added).toEqual([expect.stringContaining('view tasks__title not created: no JSON column "title"')]);
});

test("saving a view on a JSON list builds it", async () => {
  t = await startServe({ "tasks/a.yaml": "title: A\nsubtasks:\n  - title: B\n" }, config);
  await waitForAsync(async () => (await t?.api("/api/tables/tasks/rows"))?.status === 200);
  const res = await send(t, "PUT", { target: tasksTarget, rules: none, views: ["subtasks"], base: await base(t) });
  expect(res.status).toBe(200);
  expect(res.body.added).toEqual([]);
  await waitForAsync(async () =>
    ((await t?.api("/api/meta"))?.body.views ?? []).some((v: any) => v.name === "tasks__subtasks" && v.inDb),
  );
});

test("invalid indexes and views are refused, and so are indexes on a view", async () => {
  t = await startServe(
    { "tasks/a.yaml": "title: A\nsubtasks:\n  - title: B\n" },
    `${config}    expand:\n      subtasks: {}\n`,
  );
  const b = await base(t);
  for (const indexes of [
    {},
    [{ columns: [], unique: false }],
    [{ columns: ["a"] }],
    [{ expr: "", unique: true }],
    [["a"]],
  ])
    expect(await send(t, "POST", { target: tasksTarget, rules: none, indexes, base: b })).toMatchObject({
      status: 400,
      body: { field: "indexes" },
    });
  for (const views of ["subtasks", [1], [""]])
    expect(await send(t, "POST", { target: tasksTarget, rules: none, views, base: b })).toMatchObject({
      status: 400,
      body: { field: "views" },
    });
  expect(
    await send(t, "POST", { target: { table: "tasks", path: ["subtasks"] }, rules: none, indexes: [], base: b }),
  ).toMatchObject({ status: 400, body: { field: "indexes" } });
});
