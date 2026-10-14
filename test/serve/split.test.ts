import { afterEach, expect, test } from "vitest";
import { type Served, startServe, waitForAsync } from "./helpers.ts";

let t: Served | undefined;
afterEach(async () => {
  await t?.s.close();
  t = undefined;
});

const config = `tables:
  notes:
    split: type
    columns: { type: TEXT }
  posts:
    split: tags
    columns: { tags: JSON }
  flags:
    split: done
    columns: { done: BOOLEAN }
  odd:
    split: tags
    columns: { tags: JSON }
  empty:
    files: "empty/*.yaml"
    split: kind
    columns: { kind: TEXT }
  docs:
    split: meta.status
    columns: { meta: JSON }
  team_docs:
    files: "team_docs/<team>/*.yaml"
    split: team
`;
const files = {
  "notes/a.yaml": "type: idea\n",
  "notes/b.yaml": "type: idea\n",
  "notes/c.yaml": 'type: "it\'s/ok"\n',
  "notes/d.yaml": "type: 日本語\n",
  "notes/e.yaml": "title: none\n",
  "posts/x.yaml": "tags: [a, b]\n",
  "posts/y.yaml": "tags: [a]\n",
  "posts/z.yaml": "tags: []\n",
  "flags/p.yaml": "done: true\n",
  "flags/q.yaml": "done: false\n",
  "flags/r.yaml": "done: true\n",
  "odd/s.yaml": "tags: { a: 1 }\n",
  "odd/u.yaml": "tags: [a]\n",
  "docs/a.yaml": "meta: { status: draft, tags: [x, y] }\n",
  "docs/b.yaml": "meta: { status: draft }\n",
  "docs/c.yaml": "meta: { status: done, tags: [x] }\n",
  "docs/d.yaml": "meta: {}\n",
  "team_docs/platform/a.yaml": "title: A\n",
};

type Meta = { tables: Array<{ name: string; count: number; split: unknown; captures: unknown }> };
const split = (meta: Meta, name: string) => meta.tables.find((x) => x.name === name)?.split;

async function ready(served: Served): Promise<Meta> {
  let meta: Meta | undefined;
  await waitForAsync(async () => {
    meta = (await served.api("/api/meta")).body as Meta;
    return meta.tables.find((x) => x.name === "notes")?.count === 5;
  });
  return meta as Meta;
}

test("a scalar column lists its values in order, then the empty item", async () => {
  t = await startServe(files, config);
  const meta = await ready(t);
  expect(split(meta, "notes")).toEqual({
    column: "type",
    json: false,
    items: [
      { value: "idea", count: 2 },
      { value: "it's/ok", count: 1 },
      { value: "日本語", count: 1 },
      { value: null, count: 1 },
    ],
  });
});

test("a JSON column lists each element; a record is under every element and [] under none", async () => {
  t = await startServe(files, config);
  const meta = await ready(t);
  expect(split(meta, "posts")).toEqual({
    column: "tags",
    json: true,
    items: [
      { value: "a", count: 2 },
      { value: "b", count: 1 },
    ],
  });
});

test("a BOOLEAN column lists true and false", async () => {
  t = await startServe(files, config);
  const meta = await ready(t);
  expect(split(meta, "flags")).toEqual({
    column: "done",
    json: false,
    items: [
      { value: false, count: 1 },
      { value: true, count: 2 },
    ],
  });
});

test("a JSON column holding an object still answers", async () => {
  t = await startServe(files, config);
  const meta = await ready(t);
  const odd = split(meta, "odd") as { items: Array<{ value: unknown }> };
  expect(odd.items.map((i) => i.value)).toContain("a");
});

test("a table not in the database yet has no items", async () => {
  t = await startServe(files, config);
  const meta = await ready(t);
  expect(split(meta, "empty")).toEqual({ column: "kind", json: false, items: [] });
});

test("each item's filter returns exactly its records", async () => {
  t = await startServe(files, config);
  await ready(t);
  const rows = async (table: string, filter: unknown) =>
    (await t!.api(`/api/tables/${table}/rows?filter=${encodeURIComponent(JSON.stringify([filter]))}`)).body.total;
  expect(await rows("notes", { col: "type", op: "eq", value: "it's/ok" })).toBe(1);
  expect(await rows("notes", { col: "type", op: "eq", value: "日本語" })).toBe(1);
  expect(await rows("notes", { col: "type", op: "null" })).toBe(1);
  expect(await rows("posts", { col: "tags", op: "has", value: "a" })).toBe(2);
  expect(await rows("flags", { col: "done", op: "eq", value: true })).toBe(2);
});

test("a field path lists its values like a JSON column, then the empty item", async () => {
  t = await startServe(files, config);
  const meta = await ready(t);
  expect(split(meta, "docs")).toEqual({
    column: "meta.status",
    json: true,
    items: [
      { value: "done", count: 1 },
      { value: "draft", count: 2 },
      { value: null, count: 1 },
    ],
  });
});

test("rows filter by a field path", async () => {
  t = await startServe(files, config);
  await ready(t);
  const rows = async (filter: unknown) =>
    (await t!.api(`/api/tables/docs/rows?filter=${encodeURIComponent(JSON.stringify([filter]))}`)).body;
  expect((await rows({ col: "meta.status", op: "eq", value: "draft" })).total).toBe(2);
  expect((await rows({ col: "meta.status", op: "has", value: "done" })).total).toBe(1);
  expect((await rows({ col: "meta.tags", op: "has", value: "x" })).total).toBe(2);
  expect((await rows({ col: "meta.status", op: "null" })).total).toBe(1);
  expect(
    (await t!.api(`/api/tables/docs/rows?filter=${encodeURIComponent('[{"col":"nope.x","op":"eq","value":1}]')}`))
      .status,
  ).toBe(400);
});

test("meta lists a table's captures", async () => {
  t = await startServe(files, config);
  const meta = await ready(t);
  expect(meta.tables.find((x) => x.name === "team_docs")?.captures).toEqual([{ column: "team", segment: 0 }]);
  expect(meta.tables.find((x) => x.name === "notes")?.captures).toEqual([]);
});
