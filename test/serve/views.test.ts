import { afterEach, expect, test } from "vitest";
import { type Served, startServe, waitForAsync } from "./helpers.ts";

let t: Served | undefined;
afterEach(async () => {
  await t?.s.close();
  t = undefined;
});

const config = `tables:
  projects:
    expand:
      milestones:
        columns: { title: TEXT }
        references: { owner: people }
        expand:
          tasks: {}
  people:
    path: ./people.yaml
`;
const files = {
  "people.yaml": "- id: ann\n",
  "projects/website.yaml":
    "milestones:\n  - title: Design\n    owner: ann\n    tasks:\n      - title: Wireframes\n  - title: Launch\n    owner: carol\n",
  "projects/blog.yaml": "milestones:\n  - title: Draft\n",
};

async function ready(served: Served) {
  await waitForAsync(async () => {
    const views = (await served.api("/api/meta")).body.views as Array<{ inDb: boolean }> | undefined;
    return views !== undefined && views.length > 0 && views.every((v) => v.inDb);
  });
}

test("meta lists the views under their table", async () => {
  t = await startServe(files, config);
  await ready(t);
  const { body } = await t.api("/api/meta");
  expect(body.views).toEqual([
    {
      name: "projects__milestones",
      table: "projects",
      parent: "projects",
      depth: 1,
      columns: { projects_id: "TEXT", idx: "INTEGER", title: "TEXT", owner: "TEXT", tasks: "JSON" },
      identity: ["projects_id", "idx"],
      declared: { title: "TEXT" },
      count: 3,
      inDb: true,
    },
    {
      name: "projects__milestones__tasks",
      table: "projects",
      parent: "projects__milestones",
      depth: 2,
      columns: { projects_id: "TEXT", milestones_idx: "INTEGER", idx: "INTEGER", title: "TEXT" },
      identity: ["projects_id", "milestones_idx", "idx"],
      declared: {},
      count: 1,
      inDb: true,
    },
  ]);
});

test("a view's rows come back typed, in identity order, with sort, filters and prefix", async () => {
  t = await startServe(files, config);
  await ready(t);
  const rows = (query = "") => t!.api(`/api/tables/projects__milestones/rows${query}`);
  const ids = (body: { rows: Array<{ projects_id: string; idx: number; title: string }> }) =>
    body.rows.map((r) => [r.projects_id, r.idx, r.title]);
  const all = await rows();
  expect(all.body.total).toBe(3);
  expect(ids(all.body)).toEqual([
    ["blog", 0, "Draft"],
    ["website", 0, "Design"],
    ["website", 1, "Launch"],
  ]);
  expect(all.body.rows[1].tasks).toEqual([{ title: "Wireframes" }]);
  expect(ids((await rows("?sort=title:desc")).body).map((r) => r[2])).toEqual(["Launch", "Draft", "Design"]);
  const carol = encodeURIComponent(JSON.stringify([{ col: "owner", op: "eq", value: "carol" }]));
  expect(ids((await rows(`?filter=${carol}`)).body)).toEqual([["website", 1, "Launch"]]);
  expect((await rows("?prefix=web")).body.total).toBe(2);
});

test("a view is read-only", async () => {
  t = await startServe(files, config);
  await ready(t);
  const base = "/api/tables/projects__milestones/rows";
  const calls: Array<[string, string, unknown?]> = [
    ["GET", `${base}/x`],
    ["POST", base, { key: "x", values: {} }],
    ["PATCH", `${base}/x`, { values: {}, base: {} }],
    ["DELETE", `${base}/x`],
    ["POST", `${base}/x/rename`, { to: "y" }],
  ];
  for (const [method, path, body] of calls) {
    const res = await t.api(path, { method, body });
    expect(res.status).toBe(405);
    expect(res.body.error).toBe("projects__milestones is a read-only view");
  }
});

test("the table's schema lists its views with their problems", async () => {
  t = await startServe(files, config);
  await ready(t);
  const { body } = await t.api("/api/tables/projects/schema");
  expect(body.views).toEqual([
    expect.objectContaining({
      name: "projects__milestones",
      parent: "projects",
      depth: 1,
      inDb: true,
      identity: ["projects_id", "idx"],
      problems: ['projects__milestones: owner "carol" not found in people.id (website/1)'],
    }),
    expect.objectContaining({ name: "projects__milestones__tasks", depth: 2, inDb: true, problems: [] }),
  ]);
});

test("a view that cannot be created is listed as not in the DB, with the reason", async () => {
  t = await startServe(
    { "projects/website.yaml": "title: Website\n" },
    "tables:\n  projects:\n    expand:\n      nope: {}\n",
  );
  const served = t;
  await waitForAsync(async () => (await served.api("/api/meta")).body.tables?.[0]?.inDb === true);
  expect((await t.api("/api/meta")).body.views).toEqual([
    expect.objectContaining({ name: "projects__nope", inDb: false, columns: {}, identity: [], count: 0 }),
  ]);
  expect((await t.api("/api/tables/projects/schema")).body.views).toEqual([
    expect.objectContaining({
      name: "projects__nope",
      inDb: false,
      problems: ['view projects__nope not created: no JSON column "nope"'],
    }),
  ]);
  expect((await t.api("/api/tables/projects__nope/rows")).body).toEqual({ rows: [], total: 0 });
});
