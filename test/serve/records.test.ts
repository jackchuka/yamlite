import { join } from "node:path";
import { afterEach, expect, test } from "vitest";
import { open, type Yamlite } from "../../src/index.ts";
import { deleteRecord, insertRecord, readRecord, updateRecord } from "../../src/serve/records.ts";
import { writeTx } from "../../src/serve/write.ts";
import { Store } from "../../src/store.ts";
import { dataRoot, write } from "../helpers.ts";

let y: Yamlite | undefined;
let store: Store | undefined;
afterEach(async () => {
  store?.close();
  await y?.close();
  store = undefined;
  y = undefined;
});

async function setup() {
  const root = dataRoot();
  write(join(root, "tasks/a.yaml"), "title: A\ndone: false\n");
  y = await open({ root });
  await y.sync();
  store = new Store(join(root, ".yamlite", "db.sqlite"));
  return { spec: y.tables.find((t) => t.name === "tasks")!, store };
}

test("insert, update and delete records with wire values", async () => {
  const { spec, store } = await setup();
  writeTx(store, () => insertRecord(store, spec, "b", { title: "B", done: true, prio: 2 }));
  expect(readRecord(store, spec, "b")).toEqual({ id: "b", title: "B", done: true, prio: 2 });
  writeTx(store, () => updateRecord(store, spec, "a", { done: true }));
  expect(readRecord(store, spec, "a")).toMatchObject({ title: "A", done: true });
  writeTx(store, () => deleteRecord(store, spec, "a"));
  expect(readRecord(store, spec, "a")).toBeUndefined();
});

test("errors match the HTTP handlers", async () => {
  const { spec, store } = await setup();
  expect(() => writeTx(store, () => insertRecord(store, spec, "a", {}))).toThrow(/already exists/);
  expect(() => writeTx(store, () => updateRecord(store, spec, "zz", { done: true }))).toThrow(/no record "zz"/);
  expect(() => writeTx(store, () => deleteRecord(store, spec, "zz"))).toThrow(/no record "zz"/);
  expect(() => writeTx(store, () => insertRecord(store, spec, "../x", {}))).toThrow();
});

test("authorize installs and removes an authorizer", async () => {
  const { store } = await setup();
  store.authorize(() => 1 /* SQLITE_DENY */);
  expect(() => store.query("SELECT 1")).toThrow();
  store.authorize(null);
  expect(store.query("SELECT 1 AS n")).toEqual([{ n: 1n }]);
});

async function setupNotes() {
  const root = dataRoot();
  write(
    join(root, "yamlite.yaml"),
    [
      "tables:",
      "  notes:",
      '    files: "notes/<team>/*.md"',
      "    columns: { title: TEXT, tags: JSON }",
      "    formats: { tags: list }",
      "",
    ].join("\n"),
  );
  write(join(root, "notes/core/a.md"), "---\ntitle: A\ntags: []\n---\n");
  y = await open({ root });
  await y.sync();
  store = new Store(join(root, ".yamlite", "db.sqlite"));
  return { spec: y.tables.find((t) => t.name === "notes")!, store };
}

test("a key that does not match the files pattern is refused, naming the folders it needs", async () => {
  const { spec, store } = await setupNotes();
  expect(() => writeTx(store, () => insertRecord(store, spec, "b", { title: "B" }))).toThrow(
    'key must look like "<team>/<name>" to match files "*/*.md"',
  );
  writeTx(store, () => insertRecord(store, spec, "core/b", { title: "B" }));
  expect(readRecord(store, spec, "core/b")).toMatchObject({ title: "B" });
});

test("a JSON column takes only a map or list", async () => {
  const { spec, store } = await setupNotes();
  expect(() => writeTx(store, () => insertRecord(store, spec, "core/b", { tags: "x" }))).toThrow(
    '"tags" must be a JSON map or list',
  );
  expect(() => writeTx(store, () => updateRecord(store, spec, "core/a", { tags: "x" }))).toThrow(
    '"tags" must be a JSON map or list',
  );
  writeTx(store, () => updateRecord(store, spec, "core/a", { tags: ["x"] }));
  expect(readRecord(store, spec, "core/a")).toMatchObject({ tags: ["x"] });
});
