import { existsSync } from "node:fs";
import { join } from "node:path";
import { afterEach, expect, test } from "vitest";
import { parse } from "yaml";
import { read, sql, waitFor, write } from "../helpers.ts";
import { type Served, startServe, waitForAsync } from "./helpers.ts";

let t: Served | undefined;
afterEach(async () => {
  await t?.s.close();
  t = undefined;
});

const config = (t: Served) => parse(read(join(t.root, "yamlite.yaml"))) as { tables: Record<string, unknown> };
const listed = async (t: Served, name: string) =>
  (await t.api("/api/meta")).body.tables.some((x: { name: string }) => x.name === name);

test("a directory table is registered, created and synced", async () => {
  t = await startServe();
  const res = await t.api("/api/tables", { method: "POST", body: { name: "books", columns: { title: "TEXT" } } });
  expect(res).toEqual({ status: 201, body: { name: "books" } });
  expect(config(t).tables.books).toEqual({ path: "./books", key: "id", columns: { title: "TEXT" } });
  expect(sql(t.db, "SELECT name, type, pk FROM pragma_table_info('books')")).toEqual([
    { name: "id", type: "TEXT", pk: 1 },
    { name: "title", type: "TEXT", pk: 0 },
  ]);
  await waitForAsync(() => listed(t!, "books"));
  await t.api("/api/tables/books/rows", { method: "POST", body: { key: "dune", values: { title: "Dune" } } });
  await waitFor(() => existsSync(join(t!.root, "books/dune.yaml")));
});

test("a list table gets its own file", async () => {
  t = await startServe();
  await t.api("/api/tables", { method: "POST", body: { name: "people", mode: "list", key: "slug" } });
  expect(config(t).tables.people).toEqual({ path: "./people.yaml", key: "slug" });
  await waitForAsync(() => listed(t!, "people"));
  await t.api("/api/tables/people/rows", { method: "POST", body: { key: "al", values: { name: "Al" } } });
  await waitFor(() => existsSync(join(t!.root, "people.yaml")));
  expect(parse(read(join(t.root, "people.yaml")))).toEqual([{ slug: "al", name: "Al" }]);
});

test("a table made in SQL is adopted without being recreated", async () => {
  t = await startServe();
  sql(t.db, "CREATE TABLE notes (id TEXT PRIMARY KEY, body TEXT)");
  sql(t.db, "INSERT INTO notes VALUES ('n1', 'hi')");
  expect((await t.api("/api/tables", { method: "POST", body: { name: "notes", key: "nope" } })).status).toBe(400);
  expect((await t.api("/api/tables", { method: "POST", body: { name: "notes" } })).status).toBe(201);
  await waitFor(() => existsSync(join(t!.root, "notes/n1.yaml")));
  expect(read(join(t.root, "notes/n1.yaml"))).toBe("body: hi\n");
});

test("names that are taken or invalid are refused", async () => {
  t = await startServe({ "tasks/a.yaml": "title: A\n" });
  write(join(t.root, "loose.yml"), "- id: 1\n");
  const post = (body: unknown) => t!.api("/api/tables", { method: "POST", body });
  expect((await post({ name: "tasks" })).status).toBe(409);
  expect((await post({ name: "loose" })).status).toBe(409);
  expect(await post({ name: "_yamlite_state" })).toMatchObject({ status: 400, body: { field: "name" } });
  expect(await post({ name: "a b" })).toMatchObject({ status: 400, body: { field: "name" } });
  expect(await post({ name: "ok", mode: "tree" })).toMatchObject({ status: 400, body: { field: "mode" } });
  expect(await post({ name: "ok", columns: { x: "DATE" } })).toMatchObject({ status: 400, body: { field: "columns" } });
});

test("a broken yamlite.yaml is reported instead of overwritten", async () => {
  t = await startServe();
  write(join(t.root, "yamlite.yaml"), "tables: [\n");
  const res = await t.api("/api/tables", { method: "POST", body: { name: "books" } });
  expect(res.status).toBe(400);
  expect(res.body.error).toMatch(/invalid/);
  expect(read(join(t.root, "yamlite.yaml"))).toBe("tables: [\n");
});

test("a name taken by a declared view is refused before yamlite.yaml changes", async () => {
  t = await startServe({}, "tables:\n  projects:\n    expand:\n      milestones: {}\n");
  const before = read(join(t.root, "yamlite.yaml"));
  const res = await t.api("/api/tables", { method: "POST", body: { name: "projects__milestones" } });
  expect(res).toMatchObject({
    status: 409,
    body: { error: 'a view named "projects__milestones" already exists', field: "name" },
  });
  expect(read(join(t.root, "yamlite.yaml"))).toBe(before);
});
