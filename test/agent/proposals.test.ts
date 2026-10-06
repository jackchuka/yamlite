import { join } from "node:path";
import { afterEach, expect, test } from "vitest";
import { MAX_PROPOSAL_ROWS, type Proposal, ProposalStore, type RecordChange } from "../../src/agent/proposals.ts";
import { open, type Yamlite } from "../../src/index.ts";
import { readRecord, updateRecord } from "../../src/serve/records.ts";
import { writeTx } from "../../src/serve/write.ts";
import { Store } from "../../src/store.ts";
import { dataRoot, sql, write } from "../helpers.ts";

let y: Yamlite | undefined;
const stores: Store[] = [];
afterEach(async () => {
  for (const s of stores.splice(0)) s.close();
  await y?.close();
  y = undefined;
});

async function setup(files: Record<string, string> = {}) {
  const root = dataRoot();
  write(join(root, "tasks/a.yaml"), "title: A\ndone: false\ntags: [errand]\n");
  write(join(root, "tasks/b.yaml"), "title: B\ndone: false\ntags: [work]\n");
  for (const [p, c] of Object.entries(files)) write(join(root, p), c);
  y = await open({ root });
  await y.sync();
  const db = join(root, ".yamlite", "db.sqlite");
  const store = new Store(db);
  const dry = new Store(db);
  stores.push(store, dry);
  const changes: Proposal[] = [];
  const created: string[] = [];
  const tables = () => y!.tables;
  const proposals = new ProposalStore({ store, dry, tables, createTable: (t) => created.push(t.name) }, (p) =>
    changes.push(p),
  );
  const spec = (name: string) => tables().find((t) => t.name === name)!;
  return { root, db, store, proposals, changes, created, spec };
}

test("fromChanges dry-runs and leaves the database untouched", async () => {
  const t = await setup();
  const p = t.proposals.fromChanges("c1", "finish a", [
    { table: "tasks", key: "a", op: "update", values: { done: true } },
  ]);
  expect(p.status).toBe("pending");
  expect(p.rows).toEqual([
    {
      table: "tasks",
      key: "a",
      op: "update",
      before: { id: "a", title: "A", done: false, tags: ["errand"] },
      after: { id: "a", title: "A", done: true, tags: ["errand"] },
      changed: ["done"],
    },
  ]);
  expect(sql(t.db, "SELECT done FROM tasks WHERE id = 'a'")).toEqual([{ done: 0 }]);
  expect(t.changes.map((c) => c.id)).toEqual([p.id]);
});

test("fromSql diffs inserts, updates and deletes and rolls back", async () => {
  const t = await setup();
  const p = t.proposals.fromSql(
    "c1",
    "errands done",
    `UPDATE tasks SET done = 1 WHERE EXISTS (SELECT 1 FROM json_each(tags) WHERE value = 'errand');
     INSERT INTO tasks (id, title, done) VALUES ('c', 'C', 0);
     DELETE FROM tasks WHERE id = 'b';`,
  );
  expect(p.rows.map((r) => [r.key, r.op])).toEqual([
    ["a", "update"],
    ["c", "insert"],
    ["b", "delete"],
  ]);
  expect(p.sql).toContain("UPDATE tasks");
  expect(sql(t.db, "SELECT id FROM tasks ORDER BY id")).toEqual([{ id: "a" }, { id: "b" }]);
});

test("fromSql refuses anything but row edits on managed tables", async () => {
  const t = await setup();
  for (const bad of [
    "DROP TABLE tasks",
    "CREATE TABLE x (a)",
    "UPDATE _yamlite_state SET db_hash = 'x'",
    "ATTACH DATABASE ':memory:' AS m",
    "PRAGMA journal_mode = DELETE",
    "SELECT * FROM tasks",
    "COMMIT",
    "UPDATE tasks SET done = 1; COMMIT; UPDATE tasks SET done = 0",
    "SAVEPOINT s; UPDATE tasks SET done = 1; RELEASE s",
  ]) {
    expect(() => t.proposals.fromSql("c1", "bad", bad), bad).toThrow();
  }
  expect(sql(t.db, "SELECT count(*) AS n FROM tasks")).toEqual([{ n: 2 }]);
  expect(sql(t.db, "SELECT id, done FROM tasks ORDER BY id")).toEqual([
    { id: "a", done: 0 },
    { id: "b", done: 0 },
  ]);
  expect(t.proposals.pending()).toEqual([]);
});

test("a proposal that changes nothing or too much is refused", async () => {
  const t = await setup();
  expect(() => t.proposals.fromSql("c1", "noop", "UPDATE tasks SET done = done")).toThrow(/would not change/);
  const values = Array.from({ length: MAX_PROPOSAL_ROWS + 1 }, (_, i) => `('n${i}', 'x')`).join(", ");
  expect(() => t.proposals.fromSql("c1", "many", `INSERT INTO tasks (id, title) VALUES ${values}`)).toThrow(/500/);
});

test("new rule warnings are reported, existing ones are not", async () => {
  const t = await setup({ "yamlite.yaml": "tables:\n  tasks:\n    required: [title]\n" });
  await y!.sync();
  const p = t.proposals.fromChanges("c1", "blank", [
    { table: "tasks", key: "a", op: "update", values: { title: null } },
  ]);
  expect(p.warnings.length).toBe(1);
  expect(p.warnings[0]).toMatch(/title/);
});

test("apply writes every row and reports back once", async () => {
  const t = await setup();
  const p = t.proposals.fromSql("c1", "errands done", "UPDATE tasks SET done = 1; DELETE FROM tasks WHERE id = 'b'");
  expect(t.proposals.apply(p.id).status).toBe("applied");
  expect(sql(t.db, "SELECT id, done FROM tasks")).toEqual([{ id: "a", done: 1 }]);
  expect(t.proposals.pending()).toEqual([]);
  expect(t.proposals.takeFeedback("c1")).toEqual([
    `The user applied proposal ${p.id} ("errands done"); the changes are saved.`,
  ]);
  expect(t.proposals.takeFeedback("c1")).toEqual([]);
  expect(() => t.proposals.apply(p.id)).toThrow(/not pending/);
});

test("apply refuses the whole proposal when a row changed since", async () => {
  const t = await setup();
  const p = t.proposals.fromSql("c1", "all done", "UPDATE tasks SET done = 1");
  writeTx(t.store, () => updateRecord(t.store, t.spec("tasks"), "b", { title: "B2" }));
  const out = t.proposals.apply(p.id);
  expect(out.status).toBe("stale");
  expect(out.stale).toEqual(["tasks/b"]);
  expect(readRecord(t.store, t.spec("tasks"), "a")).toMatchObject({ done: false });
  expect(t.proposals.takeFeedback("c1")[0]).toMatch(/not applied.*tasks\/b/);
});

test("discard keeps the data and tells the agent", async () => {
  const t = await setup();
  const p = t.proposals.fromChanges("c1", "drop b", [{ table: "tasks", key: "b", op: "delete" }]);
  expect(t.proposals.discard(p.id).status).toBe("discarded");
  expect(sql(t.db, "SELECT count(*) AS n FROM tasks")).toEqual([{ n: 2 }]);
  expect(t.proposals.takeFeedback("c1")[0]).toMatch(/discarded/);
});

test("forTable proposes a new table and creates it on apply", async () => {
  const t = await setup();
  expect(() => t.proposals.forTable("c1", "dup", { name: "tasks", mode: "files", key: "id", columns: {} })).toThrow(
    /exists/,
  );
  const p = t.proposals.forTable("c1", "people", {
    name: "people",
    mode: "list",
    key: "id",
    columns: { name: "TEXT" },
  });
  expect(t.proposals.apply(p.id).status).toBe("applied");
  expect(t.created).toEqual(["people"]);
});

test("changes to unknown tables or records are refused with a usable message", async () => {
  const t = await setup();
  expect(() => t.proposals.fromChanges("c1", "x", [{ table: "nope", key: "a", op: "delete" }])).toThrow(
    /unknown table: nope/,
  );
  expect(() => t.proposals.fromChanges("c1", "x", [{ table: "tasks", key: "zz", op: "delete" }])).toThrow(
    /no record "zz"/,
  );
  expect(() => t.proposals.fromChanges("c1", "x", [{ table: "tasks", key: "a", op: "insert", values: {} }])).toThrow(
    /already exists/,
  );
});

test("a change with an unknown op is refused before the dry run", async () => {
  const t = await setup();
  const bad = { table: "tasks", key: "a", op: "upsert" } as unknown as RecordChange;
  expect(() => t.proposals.fromChanges("c1", "x", [bad])).toThrow(/unknown op: upsert/);
  expect(() => t.proposals.fromChanges("c1", "x", [bad])).toThrow(expect.objectContaining({ status: 400 }));
  expect(sql(t.db, "SELECT count(*) AS n FROM tasks")).toEqual([{ n: 2 }]);
  expect(t.proposals.pending()).toEqual([]);
});
