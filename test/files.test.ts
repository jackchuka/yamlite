import { chmodSync, existsSync, mkdirSync, readdirSync, symlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, test } from "vitest";
import { claims, FilesSource, invalidKey, matchesFiles } from "../src/source/files.ts";
import { YAML_GLOB } from "../src/source/yamldoc.ts";
import { read, tmpRoot, write } from "./helpers.ts";

const setup = () => {
  const dir = join(tmpRoot(), "tasks");
  return { dir, src: new FilesSource(dir, YAML_GLOB, "id") };
};

describe("FilesSource.read", () => {
  test("missing directory", () => {
    expect(setup().src.read().exists).toBe(false);
  });

  test("one record per file in every subfolder, keyed by relative path", () => {
    const { dir, src } = setup();
    write(join(dir, "a.yaml"), "title: A\nn: 1\n");
    write(join(dir, "b.yml"), "title: B\n");
    write(join(dir, ".hidden.yaml"), "x: 1\n");
    write(join(dir, "notes.txt"), "x");
    write(join(dir, "sub/c.yaml"), "x: 1\n");
    write(join(dir, "sub/deep/d.yaml"), "x: 2\n");
    write(join(dir, ".git/e.yaml"), "x: 3\n");
    write(join(dir, "sub/.cache/f.yaml"), "x: 4\n");
    write(join(dir, "node_modules/g.yaml"), "x: 5\n");
    write(join(dir, "sub/node_modules/h.yaml"), "x: 6\n");
    const r = src.read();
    expect(r.exists).toBe(true);
    expect(Object.fromEntries(r.records)).toEqual({
      a: { title: "A", n: 1n },
      b: { title: "B" },
      "sub/c": { x: 1n },
      "sub/deep/d": { x: 2n },
    });
    expect([...r.mtimes.keys()]).toEqual(["a", "b", "sub/c", "sub/deep/d"]);
    expect(r.stamps.size).toBe(4);
  });

  test("the key field may hold the full key or its last segment", () => {
    const { dir, src } = setup();
    write(join(dir, "auto/a.yaml"), "id: a\n");
    write(join(dir, "auto/b.yaml"), "id: auto/b\n");
    write(join(dir, "auto/c.yaml"), "id: zzz\n");
    const r = src.read();
    expect(r.records.get("auto/a")).toEqual({});
    expect(r.records.get("auto/b")).toEqual({});
    expect(r.warnings).toEqual([expect.stringMatching(/c\.yaml: .*file name wins/)]);
  });

  test("two files with the same nested key are both skipped", () => {
    const { dir, src } = setup();
    write(join(dir, "s/a.yaml"), "x: 1\n");
    write(join(dir, "s/a.yml"), "x: 2\n");
    write(join(dir, "s.yaml"), "x: 3\n");
    const r = src.read();
    expect(r.skip.has("s/a")).toBe(true);
    expect(r.records.has("s/a")).toBe(false);
    expect(r.records.get("s")).toEqual({ x: 3n });
  });

  test("symlinked folders are followed and loops are skipped with a warning", () => {
    const { dir, src } = setup();
    const outside = join(tmpRoot(), "shared");
    write(join(outside, "s.yaml"), "x: 1\n");
    write(join(dir, "a.yaml"), "x: 2\n");
    symlinkSync(outside, join(dir, "linked"));
    symlinkSync(dir, join(dir, "loop"));
    const r = src.read();
    expect([...r.records.keys()]).toEqual(["a", "linked/s"]);
    expect(r.warnings).toEqual([expect.stringMatching(/loop: symlink loop; skipped/)]);
  });

  // a dangling link may be an unmounted folder of records, so it is never read as a deletion
  test("a dangling symlink stops the table, whatever its name", () => {
    for (const name of ["stale-link", "b.yaml"]) {
      const { dir, src } = setup();
      write(join(dir, "a.yaml"), "x: 1\n");
      symlinkSync(join(dir, "missing"), join(dir, name));
      expect(src.read().tableError).toMatch(/ENOENT/);
    }
  });

  test.skipIf(process.getuid?.() === 0)("an unreadable subfolder stops the table", () => {
    const { dir, src } = setup();
    write(join(dir, "a.yaml"), "x: 1\n");
    write(join(dir, "locked/b.yaml"), "x: 2\n");
    chmodSync(join(dir, "locked"), 0o000);
    try {
      expect(src.read().tableError).toMatch(/EACCES/);
    } finally {
      chmodSync(join(dir, "locked"), 0o755);
    }
  });

  test("drops the key field and warns when it differs from the file name", () => {
    const { dir, src } = setup();
    write(join(dir, "a.yaml"), "id: zzz\ntitle: A\n");
    const r = src.read();
    expect(r.records.get("a")).toEqual({ title: "A" });
    expect(r.warnings.join("\n")).toMatch(/file name wins/);
  });

  test("broken, multi-document and non-mapping files are skipped", () => {
    const { dir, src } = setup();
    write(join(dir, "bad.yaml"), "title: [unclosed\n");
    write(join(dir, "multi.yaml"), "a: 1\n---\nb: 2\n");
    write(join(dir, "list.yaml"), "- 1\n");
    const r = src.read();
    expect(r.records.size).toBe(0);
    expect([...r.skip].sort()).toEqual(["bad", "list", "multi"]);
    expect(r.warnings).toHaveLength(3);
  });

  test("an empty file is an empty record and aliases are resolved", () => {
    const { dir, src } = setup();
    write(join(dir, "empty.yaml"), "");
    write(join(dir, "alias.yaml"), "base: &b {x: 1}\nuse: *b\n");
    const r = src.read();
    expect(r.records.get("empty")).toEqual({});
    expect(r.records.get("alias")).toEqual({ base: { x: 1n }, use: { x: 1n } });
  });

  test("non-ASCII file names are used as keys as-is", () => {
    const { dir, src } = setup();
    write(join(dir, "タスク.yaml"), "t: 1\n");
    expect([...src.read().records.keys()]).toEqual(["タスク"]);
  });

  test("two files with the same key are both skipped", () => {
    const { dir, src } = setup();
    write(join(dir, "a.yaml"), "x: 1\n");
    write(join(dir, "a.yml"), "x: 2\n");
    const r = src.read();
    expect(r.records.has("a")).toBe(false);
    expect(r.skip.has("a")).toBe(true);
    expect(r.mtimes.has("a")).toBe(false);
  });
});

describe("FilesSource.apply", () => {
  test("creates a new file without null fields", () => {
    const { dir, src } = setup();
    const r = src.read();
    const out = src.apply([{ kind: "put", key: "a", record: { title: "A", done: true, gone: null } }], r.stamps);
    expect(read(join(dir, "a.yaml"))).toBe("title: A\ndone: true\n");
    expect(out.written.get("a")).toEqual({ title: "A", done: true });
  });

  test("updates in place, keeping comments, formatting, explicit nulls and the key field", () => {
    const { dir, src } = setup();
    write(join(dir, "a.yaml"), "# head\nid: a\ntitle: A # note\nratio: 1.0\ndone: false\nempty: null\ngone: 1\n");
    const r = src.read();
    src.apply([{ kind: "put", key: "a", record: { title: "A", ratio: 1, done: true } }], r.stamps);
    expect(read(join(dir, "a.yaml"))).toBe("# head\nid: a\ntitle: A # note\nratio: 1.0\ndone: true\nempty: null\n");
  });

  test("keeps compact flow collections on untouched fields", () => {
    const { dir, src } = setup();
    write(join(dir, "a.yaml"), "title: A\ntags: [x, y]\nmeta: {a: 1}\n");
    const r = src.read();
    src.apply([{ kind: "put", key: "a", record: { title: "B", tags: ["x", "y"], meta: { a: 1 } } }], r.stamps);
    expect(read(join(dir, "a.yaml"))).toBe("title: B\ntags: [x, y]\nmeta: {a: 1}\n");
  });

  test("deletes a file", () => {
    const { dir, src } = setup();
    write(join(dir, "a.yml"), "x: 1\n");
    const r = src.read();
    const out = src.apply([{ kind: "delete", key: "a" }], r.stamps);
    expect(readdirSync(dir)).toEqual([]);
    expect(out.written.get("a")).toBeNull();
  });

  test("skips keys that cannot be file names or clash by case", () => {
    const { dir, src } = setup();
    write(join(dir, "Foo.yaml"), "x: 1\n");
    write(join(dir, "Auto/y.yaml"), "x: 1\n");
    const r = src.read();
    const keys = ["a/../b", ".x", "a/.x", "", "foo", "/a", "a/", "a//b", "a\\b", "node_modules/a", "auto/z"];
    const out = src.apply(
      keys.map((key) => ({ kind: "put" as const, key, record: {} })),
      r.stamps,
    );
    expect(out.skipped.map((s) => s.key)).toEqual(keys);
    expect(out.skipped.at(-1)?.reason).toBe('file name clashes with "Auto/" on case-insensitive file systems');
    expect(out.written.size).toBe(0);
  });

  test("valid nested keys", () => {
    for (const key of ["a/b", "a/b/c", "タスク/a", "a.b/c"]) expect(invalidKey(key)).toBeNull();
    expect(invalidKey("a/..")).toMatch(/dot/);
    expect(invalidKey("a//b")).toMatch(/empty path segment/);
    expect(invalidKey("a/")).toMatch(/slash/);
  });

  test("rejects keys too long for a file name", () => {
    expect(invalidKey("k".repeat(250))).toBeNull();
    expect(invalidKey("k".repeat(251))).toMatch(/too long/);
    expect(invalidKey("あ".repeat(84))).toMatch(/too long/);
    expect(invalidKey(`${"k".repeat(250)}/${"k".repeat(250)}`)).toBeNull();
    expect(invalidKey(`a/${"k".repeat(251)}`)).toMatch(/too long/);
  });

  test("creates parent folders for a new nested key", () => {
    const { dir, src } = setup();
    const r = src.read();
    const out = src.apply([{ kind: "put", key: "auto/deep/a", record: { x: 1n } }], r.stamps);
    expect(out.skipped).toEqual([]);
    expect(read(join(dir, "auto/deep/a.yaml"))).toBe("x: 1\n");
    expect([...src.read().records.keys()]).toEqual(["auto/deep/a"]);
  });

  test("a delete removes emptied folders up to, not including, the table folder", () => {
    const { dir, src } = setup();
    write(join(dir, "auto/deep/a.yaml"), "x: 1\n");
    write(join(dir, "kept/b.yaml"), "x: 1\n");
    write(join(dir, "kept/.DS_Store"), "");
    const r = src.read();
    const out = src.apply(
      [
        { kind: "delete", key: "auto/deep/a" },
        { kind: "delete", key: "kept/b" },
      ],
      r.stamps,
    );
    expect(out.skipped).toEqual([]);
    expect(existsSync(join(dir, "auto"))).toBe(false);
    expect(readdirSync(dir)).toEqual(["kept"]);
    expect(readdirSync(join(dir, "kept"))).toEqual([".DS_Store"]);
  });

  test("deleting the only record keeps the table folder", () => {
    const { dir, src } = setup();
    write(join(dir, "a.yaml"), "x: 1\n");
    const r = src.read();
    src.apply([{ kind: "delete", key: "a" }], r.stamps);
    expect(readdirSync(dir)).toEqual([]);
  });

  test("a key whose parent is a file is skipped and others proceed", () => {
    const { dir, src } = setup();
    write(join(dir, "notes"), "plain file");
    const r = src.read();
    const out = src.apply(
      [
        { kind: "put", key: "notes/x", record: { v: 1n } },
        { kind: "put", key: "y", record: { v: 2n } },
      ],
      r.stamps,
    );
    expect(out.skipped).toEqual([{ key: "notes/x", reason: expect.stringMatching(/ENOTDIR|EEXIST/) }]);
    expect(read(join(dir, "y.yaml"))).toBe("v: 2\n");
  });

  test("a failing write is skipped and other keys proceed", () => {
    const { dir, src } = setup();
    mkdirSync(join(dir, "x.yaml"), { recursive: true });
    const r = src.read();
    const out = src.apply(
      [
        { kind: "put", key: "x", record: { v: 1n } },
        { kind: "put", key: "y", record: { v: 2n } },
      ],
      r.stamps,
    );
    expect(out.skipped).toEqual([{ key: "x", reason: expect.stringMatching(/EISDIR/) }]);
    expect(read(join(dir, "y.yaml"))).toBe("v: 2\n");
  });

  test("skips a file that changed after it was read", () => {
    const { dir, src } = setup();
    write(join(dir, "a.yaml"), "x: 1\n");
    const r = src.read();
    writeFileSync(join(dir, "a.yaml"), "x: 2\n");
    const out = src.apply([{ kind: "put", key: "a", record: { x: 3n } }], r.stamps);
    expect(out.skipped[0]?.reason).toMatch(/changed/);
    expect(read(join(dir, "a.yaml"))).toBe("x: 2\n");
  });

  test("writes atomically without leaving temp files", () => {
    const { dir, src } = setup();
    const r = src.read();
    src.apply([{ kind: "put", key: "a", record: { x: 1 } }], r.stamps);
    expect(readdirSync(dir)).toEqual(["a.yaml"]);
  });
});

describe("FilesSource.apply on unreadable files", () => {
  test("never modifies a broken file", () => {
    const { dir, src } = setup();
    write(join(dir, "bad.yaml"), "title: [unclosed\n");
    const r = src.read();
    const out = src.apply(
      [
        { kind: "put", key: "bad", record: { x: 1 } },
        { kind: "delete", key: "bad" },
      ],
      r.stamps,
    );
    expect(out.skipped.map((s) => s.reason)).toEqual([
      "file could not be read; not modified",
      "file could not be read; not modified",
    ]);
    expect(out.written.size).toBe(0);
    expect(read(join(dir, "bad.yaml"))).toBe("title: [unclosed\n");
  });

  test("never modifies duplicate-key files", () => {
    const { dir, src } = setup();
    write(join(dir, "a.yaml"), "x: 1\n");
    write(join(dir, "a.yml"), "x: 2\n");
    const r = src.read();
    const out = src.apply(
      [
        { kind: "put", key: "a", record: { x: 3 } },
        { kind: "delete", key: "a" },
      ],
      r.stamps,
    );
    expect(out.skipped).toHaveLength(2);
    expect(read(join(dir, "a.yaml"))).toBe("x: 1\n");
    expect(read(join(dir, "a.yml"))).toBe("x: 2\n");
  });
});

test("parse errors are reported on one line", () => {
  const dir = join(tmpRoot(), "tasks");
  write(join(dir, "bad.yaml"), "title: [broken\n");
  const r = new FilesSource(dir, YAML_GLOB, "id").read();
  expect(r.warnings).toHaveLength(1);
  expect(r.warnings[0]).not.toContain("\n");
  expect(r.warnings[0]).toMatch(/bad\.yaml: .+ at line \d+, column \d+; skipped$/);
});

describe("FilesSource with tables nested inside", () => {
  const nested = () => {
    const dir = join(tmpRoot(), "tasks");
    const exclude = [
      { owner: 'table "archive"', path: join(dir, "archive"), glob: YAML_GLOB, tie: false },
      { owner: 'table "people"', path: join(dir, "people.yaml"), glob: null, tie: false },
    ];
    return { dir, src: new FilesSource(dir, YAML_GLOB, "id", exclude) };
  };

  test("never reads the files of other tables", () => {
    const { dir, src } = nested();
    write(join(dir, "a.yaml"), "x: 1\n");
    write(join(dir, "archive/old.yaml"), "x: 2\n");
    write(join(dir, "people.yaml"), "- id: 1\n");
    write(join(dir, "archived/c.yaml"), "x: 3\n");
    expect([...src.read().records.keys()]).toEqual(["a", "archived/c"]);
  });

  test("never writes into them", () => {
    const { dir, src } = nested();
    const r = src.read();
    const out = src.apply(
      ["archive/x", "people", "archived/y"].map((key) => ({ kind: "put" as const, key, record: { v: 1n } })),
      r.stamps,
    );
    expect(out.skipped).toEqual([
      { key: "archive/x", reason: 'key belongs to table "archive"' },
      { key: "people", reason: 'key belongs to table "people"' },
    ]);
    expect(existsSync(join(dir, "archive"))).toBe(false);
    expect(read(join(dir, "archived/y.yaml"))).toBe("v: 1\n");
  });

  test("a nested table takes only the files its glob matches", () => {
    const dir = join(tmpRoot(), "tasks");
    const exclude = [{ owner: 'table "archive"', path: join(dir, "archive"), glob: "*.yaml", tie: false }];
    write(join(dir, "archive/old.yaml"), "x: 1\n");
    write(join(dir, "archive/deep/kept.yaml"), "x: 2\n");
    const src = new FilesSource(dir, YAML_GLOB, "id", exclude);
    expect([...src.read().records.keys()]).toEqual(["archive/deep/kept"]);
  });

  test("a file two tables with the same folder both match stops the table", () => {
    const dir = join(tmpRoot(), "x");
    write(join(dir, "a.yaml"), "x: 1\n");
    const exclude = [{ owner: 'table "b"', path: dir, glob: "**/*.yaml", tie: true }];
    const r = new FilesSource(dir, "*.yaml", "id", exclude).read();
    expect(r.tableError).toBe(`files overlap with table "b": ${join(dir, "a.yaml")}`);
  });
});

describe("FilesSource globs", () => {
  test("only files the glob matches are records", () => {
    const dir = join(tmpRoot(), "t");
    write(join(dir, "a.yaml"), "x: 1\n");
    write(join(dir, "b.yml"), "x: 2\n");
    write(join(dir, "sub/c.yaml"), "x: 3\n");
    write(join(dir, "notes.md"), "# hi\n");
    expect([...new FilesSource(dir, "*.yaml", "id").read().records.keys()]).toEqual(["a"]);
    expect([...new FilesSource(dir, YAML_GLOB, "id").read().records.keys()]).toEqual(["a", "b", "sub/c"]);
  });

  test("extensions match whatever their case, as before", () => {
    const dir = join(tmpRoot(), "t");
    write(join(dir, "Buy-Milk.YAML"), "x: 1\n");
    write(join(dir, "sub/Old.Yml"), "x: 2\n");
    expect([...new FilesSource(dir, YAML_GLOB, "id").read().records.keys()]).toEqual(["Buy-Milk", "sub/Old"]);
  });

  test("a new key whose file the glob does not match is not written", () => {
    const dir = join(tmpRoot(), "t");
    const src = new FilesSource(dir, "*.yaml", "id");
    const out = src.apply(
      ["a/b", "c"].map((key) => ({ kind: "put" as const, key, record: { v: 1n } })),
      src.read().stamps,
    );
    expect(out.skipped).toEqual([{ key: "a/b", reason: 'key does not match files "*.yaml"' }]);
    expect(existsSync(join(dir, "a"))).toBe(false);
    expect(read(join(dir, "c.yaml"))).toBe("v: 1\n");
  });

  test("matchesFiles and claims", () => {
    expect(matchesFiles("a/B.YAML", YAML_GLOB)).toBe(true);
    expect(matchesFiles("a/.hidden/b.yaml", YAML_GLOB)).toBe(false);
    expect(matchesFiles("b.md", YAML_GLOB)).toBe(false);
    const list = { owner: "yamlite.yaml", path: "/r/yamlite.yaml", glob: null, tie: false };
    expect(claims(list, "/r/yamlite.yaml")).toBe(true);
    expect(claims(list, "/r/other.yaml")).toBe(false);
    const folder = { owner: 'table "a"', path: "/r/a", glob: "*.yaml", tie: false };
    expect(claims(folder, "/r/a/x.yaml")).toBe(true);
    expect(claims(folder, "/r/a/s/x.yaml")).toBe(false);
    expect(claims(folder, "/r/ab/x.yaml")).toBe(false);
    expect(claims(folder, "/r/a")).toBe(false);
  });
});
