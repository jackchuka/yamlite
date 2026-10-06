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
