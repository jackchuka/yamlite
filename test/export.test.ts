import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, symlinkSync } from "node:fs";
import { basename, dirname, join, relative } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { expect, test } from "vitest";
import { exportSite, warningScrubber, writeSnapshotData } from "../src/export.ts";
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

test("the snapshot carries each table's split items", async () => {
  const root = setup({ "yamlite.yaml": "tables:\n  notes:\n    split: text\n    columns: { text: TEXT }\n" });
  const dir = tmpRoot();
  await writeSnapshotData({ root, dir });
  const notes = readJson(join(dir, "data/snapshot.json")).meta.tables.find((t: any) => t.name === "notes");
  expect(notes.split).toEqual({ column: "text", json: false, items: [{ value: "日本語", count: 1 }] });
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

test("--table drops references to the tables it leaves out", async () => {
  const root = setup({
    "yamlite.yaml":
      "tables:\n  projects:\n    references: { owner: people, note: notes }\n    expand:\n      milestones:\n        references: { lead: people, about: projects }\n  notes: {}\n",
    "projects/website.yaml":
      "title: Website\nowner: ann\nnote: x\nmilestones:\n  - title: Design\n    lead: ann\n    about: website\n",
  });
  const dir = tmpRoot();
  await writeSnapshotData({ root, dir, tables: ["projects", "notes"] });
  const snap = readJson(join(dir, "data/snapshot.json"));
  const tableRefs = snap.meta.tables.find((t: any) => t.name === "projects").references;
  expect(tableRefs).toEqual([{ column: "note", table: "notes" }]);
  expect(snap.meta.views[0].references).toEqual([{ column: "about", table: "projects" }]);
  expect(snap.schemas.projects.references.map((r: any) => [r.column, r.table])).toEqual([["note", "notes"]]);
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
  expect(notes).toEqual({ files: { "notes/a b#1.yaml": "text: 日本語\n" }, keys: { "a b#1": "notes/a b#1.yaml" } });
  const projects = readJson(join(dir, "data/yaml/projects.json"));
  expect(projects.files[projects.keys.website]).toContain("# the site");
});

test("a record key named __proto__ keeps its YAML", async () => {
  const root = setup({ "notes/__proto__.yaml": "text: odd\n" });
  const dir = tmpRoot();
  await writeSnapshotData({ root, dir, tables: ["notes"] });
  const notes = readJson(join(dir, "data/yaml/notes.json"));
  expect(Object.hasOwn(notes.keys, "__proto__")).toBe(true);
  expect(notes.files[notes.keys.__proto__]).toBe("text: odd\n");
});

test("list tables map every key to the list file, whose text is stored once", async () => {
  const root = setup();
  const dir = tmpRoot();
  await writeSnapshotData({ root, dir });
  const people = readJson(join(dir, "data/yaml/people.json"));
  expect(people).toEqual({
    files: { "people.yaml": files["people.yaml"] },
    keys: { ann: "people.yaml", bob: "people.yaml" },
  });
});

test("a large list table's YAML map grows with the file, not with records times the file", async () => {
  const items = Array.from(
    { length: 1000 },
    (_, i) => `- id: p${String(i).padStart(4, "0")}\n  name: Person ${i}\n`,
  ).join("");
  const root = setup({ "people.yaml": items });
  const dir = tmpRoot();
  await writeSnapshotData({ root, dir, tables: ["people"] });
  const path = join(dir, "data/yaml/people.json");
  const people = readJson(path);
  expect(Object.keys(people.files)).toEqual(["people.yaml"]);
  expect(Object.keys(people.keys)).toHaveLength(1000);
  expect(statSync(path).size).toBeLessThan(items.length * 3);
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

function ui(): string {
  const dir = tmpRoot();
  write(join(dir, "index.html"), '<!doctype html><html><head><meta charset="UTF-8" /></head><body></body></html>');
  write(join(dir, "assets/app.js"), "console.log(1)");
  write(join(dir, "favicon.svg"), "<svg/>");
  return dir;
}

test("exportSite writes the UI marked static next to the data", async () => {
  const out = join(tmpRoot(), "site");
  const r = await exportSite({ root: setup(), out, uiDir: ui() });
  expect(r.out).toBe(out);
  expect(readFileSync(join(out, "index.html"), "utf8")).toContain('<meta name="yamlite-mode" content="static" />');
  for (const p of ["assets/app.js", "favicon.svg", "data/snapshot.json", "data/db.sqlite", "data/yaml/people.json"]) {
    expect(existsSync(join(out, p)), p).toBe(true);
  }
});

test("index.html tells a file:// visitor to use a web server, in a classic script that runs there", async () => {
  const out = join(tmpRoot(), "site");
  await exportSite({ root: setup(), out, uiDir: ui() });
  const html = readFileSync(join(out, "index.html"), "utf8");
  const scripts = [...html.matchAll(/<script([^>]*)>([\s\S]*?)<\/script>/g)];
  const guard = scripts.find((m) => m[2]?.includes('location.protocol === "file:"'));
  expect(guard).toBeDefined();
  expect(guard?.[1]).not.toMatch(/type=["']?module/);
  expect(guard?.[1]).not.toMatch(/src=/);
  expect(guard?.[2]).toContain("スナップショットを開くには Web サーバーが必要です。");
  expect(guard?.[2]).toContain("このフォルダを Web サーバー経由で開いてください（例: npx serve）");
});

test("a previous export is replaced, another folder is refused unless forced", async () => {
  const root = setup();
  const out = join(tmpRoot(), "site");
  await exportSite({ root, out, uiDir: ui() });
  write(join(out, "data/yaml/stale.json"), "{}");
  await exportSite({ root, out, uiDir: ui() });
  expect(existsSync(join(out, "data/yaml/stale.json"))).toBe(false);

  const other = tmpRoot();
  write(join(other, "keep.txt"), "mine");
  await expect(exportSite({ root, out: other, uiDir: ui() })).rejects.toThrow("not a yamlite export");
  expect(readFileSync(join(other, "keep.txt"), "utf8")).toBe("mine");
  await exportSite({ root, out: other, uiDir: ui(), force: true });
  expect(existsSync(join(other, "keep.txt"))).toBe(false);

  const empty = join(tmpRoot(), "empty");
  mkdirSync(empty);
  await expect(exportSite({ root, out: empty, uiDir: ui() })).resolves.toBeDefined();
});

test("a failed export leaves the previous one untouched and no temp folder behind", async () => {
  const root = setup();
  const parent = tmpRoot();
  const out = join(parent, "site");
  await exportSite({ root, out, uiDir: ui() });
  const before = tree(out);
  await expect(exportSite({ root, out, uiDir: ui(), tables: ["nope"] })).rejects.toThrow("unknown table");
  expect(tree(out)).toEqual(before);
  expect(readdirSync(parent)).toEqual(["site"]);
});

test("a UI folder without index.html is refused", async () => {
  await expect(exportSite({ root: setup(), out: join(tmpRoot(), "s"), uiDir: tmpRoot() })).rejects.toThrow(
    "index.html",
  );
});

test("SOURCE_DATE_EPOCH makes two exports byte-identical", async () => {
  const root = setup();
  const a = join(tmpRoot(), "a");
  const b = join(tmpRoot(), "b");
  process.env.SOURCE_DATE_EPOCH = "1790000000";
  try {
    await exportSite({ root, out: a, uiDir: ui() });
    await exportSite({ root, out: b, uiDir: ui() });
  } finally {
    delete process.env.SOURCE_DATE_EPOCH;
  }
  expect(tree(b)).toEqual(tree(a));
  expect(readJson(join(a, "data/snapshot.json")).generatedAt).toBe(new Date(1790000000 * 1000).toISOString());
});

test("the output folder may not contain the data root or be a table inside it", async () => {
  const root = setup();
  await expect(exportSite({ root, out: root, uiDir: ui(), force: true })).rejects.toThrow("contains the data root");
  expect(readFileSync(join(root, "people.yaml"), "utf8")).toContain("Ann");
  await expect(exportSite({ root, out: join(root, ".."), uiDir: ui(), force: true })).rejects.toThrow(
    "contains the data root",
  );
  expect(existsSync(join(root, "people.yaml"))).toBe(true);
  await expect(exportSite({ root, out: join(root, "site"), uiDir: ui() })).rejects.toThrow("inside the data root");
  expect(existsSync(join(root, "site"))).toBe(false);

  const out = join(root, ".site");
  await exportSite({ root, out, uiDir: ui() });
  expect(existsSync(join(out, "index.html"))).toBe(true);
  const snapshot = readJson(join(out, "data/snapshot.json"));
  expect(Object.keys(snapshot.schemas)).not.toContain(".site");
  expect(Object.keys(snapshot.schemas)).not.toContain("site");
});

test("an output folder reached through a symlink may not be the data root or contain it, even with --force", async () => {
  const root = setup();
  const links = tmpRoot();
  symlinkSync(root, join(links, "root"));
  symlinkSync(dirname(root), join(links, "parent"));
  for (const out of [join(links, "root"), join(links, "parent", basename(root)), join(links, "parent")]) {
    await expect(exportSite({ root, out, uiDir: ui(), force: true }), out).rejects.toThrow("contains the data root");
    expect(readFileSync(join(root, "people.yaml"), "utf8")).toContain("Ann");
  }
  await expect(exportSite({ root, out: join(links, "root", "site"), uiDir: ui() })).rejects.toThrow(
    "inside the data root",
  );
  expect(existsSync(join(root, "site"))).toBe(false);
});

const caseInsensitive = (() => {
  const dir = join(tmpRoot(), "Probe");
  mkdirSync(dir);
  return existsSync(join(dirname(dir), "probe"));
})();

test.skipIf(!caseInsensitive)(
  "an output folder differing from the root only in letter case is refused on a case-insensitive file system",
  async () => {
    const parent = tmpRoot();
    const root = join(parent, "ci", "Notes");
    for (const [p, c] of Object.entries(files)) write(join(root, p), c);
    for (const out of [join(parent, "ci", "notes"), join(parent, "CI")]) {
      await expect(exportSite({ root, out, uiDir: ui(), force: true }), out).rejects.toThrow("contains the data root");
      expect(readFileSync(join(root, "people.yaml"), "utf8")).toContain("Ann");
    }
    await expect(exportSite({ root, out: join(parent, "ci", "NOTES", "site"), uiDir: ui() })).rejects.toThrow(
      "inside the data root",
    );
  },
);

test("a root folder whose name starts with two dots is still protected from its parent", async () => {
  const parent = tmpRoot();
  const root = join(parent, "..data");
  for (const [p, c] of Object.entries(files)) write(join(root, p), c);
  await expect(exportSite({ root, out: parent, uiDir: ui(), force: true })).rejects.toThrow("contains the data root");
  expect(readFileSync(join(root, "people.yaml"), "utf8")).toContain("Ann");
  write(join(parent, "yamlite.yaml"), "tables: {}\n");
  await expect(exportSite({ root: parent, out: join(parent, "..site"), uiDir: ui() })).resolves.toBeDefined();
});

test("the output folder may not be the state folder or inside it, even with --force", async () => {
  const root = setup();
  write(join(root, ".yamlite/db.sqlite"), "db");
  for (const out of [join(root, ".yamlite"), join(root, ".yamlite", "site")]) {
    await expect(exportSite({ root, out, uiDir: ui(), force: true }), out).rejects.toThrow(".yamlite");
  }
  expect(readFileSync(join(root, ".yamlite/db.sqlite"), "utf8")).toBe("db");
  expect(existsSync(join(root, ".yamlite", "site"))).toBe(false);
});

test("an invalid SOURCE_DATE_EPOCH is reported by name", async () => {
  for (const value of ["soon", "-1", "1.5", "1e400"]) {
    process.env.SOURCE_DATE_EPOCH = value;
    try {
      await expect(writeSnapshotData({ root: setup(), dir: tmpRoot() }), value).rejects.toThrow(
        `SOURCE_DATE_EPOCH must be a whole number of seconds: ${value}`,
      );
    } finally {
      delete process.env.SOURCE_DATE_EPOCH;
    }
  }
});

test("a warning naming the bare root shows the root's folder name", () => {
  const scrub = warningScrubber("/home/me/notes", ["/elsewhere/people.yaml"]);
  expect(scrub("cannot read /home/me/notes")).toBe("cannot read notes");
  expect(scrub("cannot read /home/me/notes/a.yaml and /home/me/notes.")).toBe("cannot read a.yaml and notes.");
  expect(scrub("see /home/me/notes-old/x.yaml")).toBe("see notes-old/x.yaml");
  expect(scrub("see /elsewhere/people.yaml")).toBe("see people.yaml");
});

test("pages are written next to the data, and pages that cannot be exported are reported", async () => {
  const root = setup({
    "yamlite.yaml":
      files["yamlite.yaml"] +
      "pages:\n  board:\n    path: .pages/board.html\n    access: { projects: read, projects__milestones: read }\n" +
      "  people-page:\n    path: .pages/people.html\n    access: { people: read }\n" +
      "  gone:\n    path: .pages/missing.html\n",
    ".pages/board.html": "<p>board</p>",
    ".pages/people.html": "<p>people</p>",
  });
  const dir = tmpRoot();
  const r = await writeSnapshotData({ root, dir, tables: ["projects", "notes"] });
  expect(readFileSync(join(dir, "data/pages/board.html"), "utf8")).toBe("<p>board</p>");
  expect(existsSync(join(dir, "data/pages/people-page.html"))).toBe(false);
  const snap = readJson(join(dir, "data/snapshot.json"));
  expect(snap.meta.pages).toEqual([
    {
      name: "board",
      title: "board",
      path: ".pages/board.html",
      access: { projects: "read", projects__milestones: "read" },
      sql: false,
      network: [],
    },
  ]);
  expect(r.pages).toEqual(["board"]);
  expect(r.skippedPages).toEqual({
    "people-page": "uses people, which the export leaves out",
    gone: "page file not found: .pages/missing.html",
  });
});

test("a files table outside the root keeps only its folder name in the files pattern", async () => {
  const outside = tmpRoot();
  write(join(outside, "n.yaml"), "body: hi\n");
  const root = setup({ "yamlite.yaml": `tables:\n  notes: {}\n  inbox:\n    files: ${outside}/*.yaml\n` });
  const dir = tmpRoot();
  await writeSnapshotData({ root, dir });
  const snap = readJson(join(dir, "data/snapshot.json"));
  const table = (name: string) => snap.meta.tables.find((t: any) => t.name === name);
  expect(table("inbox").files).toBe(`${basename(outside)}/*.yaml`);
  expect(snap.schemas.inbox.files).toBe(`${basename(outside)}/*.yaml`);
  expect(table("notes").files).toBe("notes/**/*.{yaml,yml}");
});
