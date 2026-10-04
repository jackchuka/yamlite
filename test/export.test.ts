import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { expect, test } from "vitest";
import { writeSnapshotData } from "../src/export.ts";
import { acquireLock } from "../src/lock.ts";
import { startServe } from "./serve/helpers.ts";
import { dataRoot, tmpRoot, write } from "./helpers.ts";

const files = {
  "yamlite.yaml":
    "tables:\n  projects:\n    references: { owner: people }\n    expand:\n      milestones: {}\n  notes: {}\n",
  "projects/website.yaml": "# the site\ntitle: Website\nowner: ann\nmilestones:\n  - title: Design\n",
  "people.yaml": "- id: ann\n  name: Ann\n- id: bob\n  name: Bob\n",
  "notes/a b#1.yaml": "text: 日本語\n",
  "secret/x.yaml": "token: abc\n",
};

function setup(extra: Record<string, string> = {}) {
  const root = dataRoot();
  for (const [p, c] of Object.entries({ ...files, ...extra })) write(join(root, p), c);
  return root;
}

const readJson = (path: string) => JSON.parse(readFileSync(path, "utf8")) as any;

function tree(dir: string): Record<string, string> {
  const out: Record<string, string> = {};
  const walk = (d: string) => {
    for (const e of readdirSync(d, { withFileTypes: true })) {
      const p = join(d, e.name);
      if (e.isDirectory()) walk(p);
      else out[relative(dir, p)] = readFileSync(p).toString("base64");
    }
  };
  walk(dir);
  return out;
}

test("the snapshot meta and schemas match what serve answers, with machine paths hidden", async () => {
  const root = setup();
  const dir = tmpRoot();
  await writeSnapshotData({ root, dir, now: () => new Date("2026-10-02T00:00:00Z") });
  const snap = readJson(join(dir, "data/snapshot.json"));
  const t = await startServe({}, undefined, { root });
  try {
    const served = (await t.api("/api/meta")).body;
    expect(snap.meta.tables).toEqual(served.tables);
    expect(snap.meta.views).toEqual(served.views);
    expect(snap.meta.root).toBe(root.split("/").at(-1));
    expect(snap.meta.db).toBe("data/db.sqlite");
    expect(snap.meta.configError).toBeNull();
    for (const name of ["projects", "people", "notes", "secret"]) {
      expect(snap.schemas[name]).toEqual((await t.api(`/api/tables/${name}/schema`)).body);
    }
  } finally {
    await t.s.close();
  }
  expect(snap.version).toBe(1);
  expect(snap.generatedAt).toBe("2026-10-02T00:00:00.000Z");
});

test("--table leaves the other tables and their views out of the snapshot and the database", async () => {
  const root = setup();
  const dir = tmpRoot();
  const r = await writeSnapshotData({ root, dir, tables: ["people", "notes"] });
  expect(r.tables).toEqual(["people", "notes"]);
  const snap = readJson(join(dir, "data/snapshot.json"));
  expect(snap.meta.tables.map((t: any) => t.name)).toEqual(["people", "notes"]);
  expect(snap.meta.views).toEqual([]);
  expect(Object.keys(snap.schemas)).toEqual(["people", "notes"]);
  const db = new DatabaseSync(join(dir, "data/db.sqlite"), { readOnly: true });
  try {
    const names = db.prepare("SELECT name FROM sqlite_schema WHERE type IN ('table','view') ORDER BY name").all();
    expect(names.map((n: any) => n.name)).toEqual(["_yamlite_views", "notes", "people"]);
    expect(db.prepare("PRAGMA journal_mode").get()).toEqual({ journal_mode: "delete" });
  } finally {
    db.close();
  }
});

test("internal bookkeeping is stripped and the view registry kept", async () => {
  const root = setup();
  const dir = tmpRoot();
  await writeSnapshotData({ root, dir });
  const db = new DatabaseSync(join(dir, "data/db.sqlite"), { readOnly: true });
  try {
    const names = db
      .prepare("SELECT name FROM sqlite_schema WHERE type IN ('table','view') ORDER BY name")
      .all()
      .map((n: any) => n.name);
    expect(names).toEqual(["_yamlite_views", "notes", "people", "projects", "projects__milestones", "secret"]);
    expect(db.prepare("SELECT name, tbl FROM _yamlite_views").all()).toEqual([
      { name: "projects__milestones", tbl: "projects" },
    ]);
  } finally {
    db.close();
  }
});

test("yaml map keys and file names survive unusual names", async () => {
  const root = setup();
  const dir = tmpRoot();
  await writeSnapshotData({ root, dir });
  const notes = readJson(join(dir, "data/yaml/notes.json"));
  expect(notes).toEqual({ "a b#1": { file: "notes/a b#1.yaml", yaml: "text: 日本語\n" } });
  const projects = readJson(join(dir, "data/yaml/projects.json"));
  expect(projects.website.yaml).toContain("# the site");
});

test("list tables map every key to the list file", async () => {
  const root = setup();
  const dir = tmpRoot();
  await writeSnapshotData({ root, dir });
  const people = readJson(join(dir, "data/yaml/people.json"));
  expect(Object.keys(people)).toEqual(["ann", "bob"]);
  expect(people.bob).toEqual({ file: "people.yaml", yaml: files["people.yaml"] });
});

test("warnings from the sync are kept per table", async () => {
  const root = setup({ "projects/broken.yaml": "owner: zed\n" });
  const dir = tmpRoot();
  const r = await writeSnapshotData({ root, dir });
  expect(r.warnings.projects?.some((w) => w.includes('"zed"'))).toBe(true);
  expect(readJson(join(dir, "data/snapshot.json")).warnings).toEqual(r.warnings);
});

test("nothing under the root changes", async () => {
  const root = setup({ "drafts/x.yaml": "a: 1\n" });
  const before = tree(root);
  await writeSnapshotData({ root, dir: tmpRoot() });
  expect(tree(root)).toEqual(before);
});

test("export works while the root is locked by another process", async () => {
  const root = setup();
  const release = acquireLock(join(root, ".yamlite"));
  try {
    await expect(writeSnapshotData({ root, dir: tmpRoot() })).resolves.toBeDefined();
  } finally {
    release();
  }
});

test("the same input gives byte-identical data", async () => {
  const root = setup();
  const a = tmpRoot();
  const b = tmpRoot();
  const now = () => new Date("2026-10-02T00:00:00Z");
  await writeSnapshotData({ root, dir: a, now });
  await writeSnapshotData({ root, dir: b, now });
  expect(tree(b)).toEqual(tree(a));
  expect(statSync(join(a, "data/db.sqlite")).size).toBeGreaterThan(0);
});

test("an unknown --table fails", async () => {
  await expect(writeSnapshotData({ root: setup(), dir: tmpRoot(), tables: ["nope"] })).rejects.toThrow(
    "unknown table: nope",
  );
});

test("warnings never reveal the machine path of the root", async () => {
  const root = setup({ "projects/bad.yaml": "a: [1, 2\n" });
  const r = await writeSnapshotData({ root, dir: tmpRoot() });
  const all = (r.warnings.projects ?? []).join("\n");
  expect(all).toContain("projects/bad.yaml");
  expect(JSON.stringify(r.warnings)).not.toContain(root);
});
