import { mkdirSync, readdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, test } from "vitest";
import { DirSource, invalidKey } from "../src/source/dir.ts";
import { read, tmpRoot, write } from "./helpers.ts";

const setup = () => {
  const dir = join(tmpRoot(), "tasks");
  return { dir, src: new DirSource(dir, "id") };
};

describe("DirSource.read", () => {
  test("missing directory", () => {
    expect(setup().src.read().exists).toBe(false);
  });

  test("one record per file, keyed by file name", () => {
    const { dir, src } = setup();
    write(join(dir, "a.yaml"), "title: A\nn: 1\n");
    write(join(dir, "b.yml"), "title: B\n");
    write(join(dir, ".hidden.yaml"), "x: 1\n");
    write(join(dir, "notes.txt"), "x");
    write(join(dir, "sub/c.yaml"), "x: 1\n");
    const r = src.read();
    expect(r.exists).toBe(true);
    expect(Object.fromEntries(r.records)).toEqual({ a: { title: "A", n: 1n }, b: { title: "B" } });
    expect([...r.mtimes.keys()]).toEqual(["a", "b"]);
    expect(r.stamps.size).toBe(2);
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

describe("DirSource.apply", () => {
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
    const r = src.read();
    const out = src.apply(
      ["a/b", ".x", "", "foo"].map((key) => ({ kind: "put" as const, key, record: {} })),
      r.stamps,
    );
    expect(out.skipped.map((s) => s.key)).toEqual(["a/b", ".x", "", "foo"]);
    expect(out.written.size).toBe(0);
  });

  test("rejects keys too long for a file name", () => {
    expect(invalidKey("k".repeat(250))).toBeNull();
    expect(invalidKey("k".repeat(251))).toMatch(/too long/);
    expect(invalidKey("あ".repeat(84))).toMatch(/too long/);
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

describe("DirSource.apply on unreadable files", () => {
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
  const r = new DirSource(dir, "id").read();
  expect(r.warnings).toHaveLength(1);
  expect(r.warnings[0]).not.toContain("\n");
  expect(r.warnings[0]).toMatch(/bad\.yaml: .+ at line \d+, column \d+; skipped$/);
});
