import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, test } from "vitest";
import { ListSource } from "../src/source/list.ts";
import { read, tmpRoot, write } from "./helpers.ts";

const setup = () => {
  const file = join(tmpRoot(), "people.yaml");
  return { file, src: new ListSource(file, "id") };
};

describe("ListSource.read", () => {
  test("records keyed by the key field", () => {
    const { file, src } = setup();
    write(file, "- id: 1\n  name: A\n- id: b\n  name: B\n");
    expect(Object.fromEntries(src.read().records)).toEqual({ "1": { id: 1n, name: "A" }, b: { id: "b", name: "B" } });
  });

  test("ignores items without key or not a mapping, skips duplicates", () => {
    const { file, src } = setup();
    write(file, "- name: nokey\n- just a string\n- id: d\n- id: d\n- id: ok\n");
    const r = src.read();
    expect([...r.records.keys()]).toEqual(["ok"]);
    expect([...r.skip]).toEqual(["d"]);
    expect(r.warnings).toHaveLength(3);
  });

  test("table errors and empty files", () => {
    const { file, src } = setup();
    write(file, "a: 1\n");
    expect(src.read().tableError).toMatch(/must be a sequence/);
    write(file, "- [\n");
    expect(src.read().tableError).not.toBeNull();
    write(file, "");
    const r = src.read();
    expect(r).toMatchObject({ exists: true, tableError: null });
    expect(r.records.size).toBe(0);
  });

  test("a mapping file hints that it looks like a single record", () => {
    const { file, src } = setup();
    write(file, "title: A\n");
    expect(src.read().tableError).toMatch(/looks like a single record; run yamlite on the parent directory/);
    write(file, "just text\n");
    expect(src.read().tableError).not.toMatch(/single record/);
  });
});

describe("ListSource.apply", () => {
  test("updates items in place keeping comments", () => {
    const { file, src } = setup();
    write(file, "# people\n- id: 1\n  name: A # first\n  age: 3\n");
    const r = src.read();
    const out = src.apply([{ kind: "put", key: "1", record: { id: 1, name: "A", age: 4n } }], r.stamps);
    expect(read(file)).toBe("# people\n- id: 1\n  name: A # first\n  age: 4\n");
    expect(out.written.get("1")).toEqual({ id: 1n, name: "A", age: 4n });
  });

  test("keeps compact flow collections on untouched fields", () => {
    const { file, src } = setup();
    write(file, "- id: 1\n  tags: [x, y]\n  age: 3\n");
    const r = src.read();
    src.apply([{ kind: "put", key: "1", record: { id: 1, tags: ["x", "y"], age: 4n } }], r.stamps);
    expect(read(file)).toBe("- id: 1\n  tags: [x, y]\n  age: 4\n");
  });

  test("appends and deletes items", () => {
    const { file, src } = setup();
    write(file, "- id: 1\n  name: A\n- id: 2\n  name: B\n");
    const r = src.read();
    const out = src.apply(
      [
        { kind: "delete", key: "1" },
        { kind: "put", key: "3", record: { id: 3n, name: "C", gone: null } },
      ],
      r.stamps,
    );
    expect(read(file)).toBe("- id: 2\n  name: B\n- id: 3\n  name: C\n");
    expect(out.written.get("1")).toBeNull();
    expect(out.written.get("3")).toEqual({ id: 3n, name: "C" });
  });

  test("creates the file when missing", () => {
    const { file, src } = setup();
    const r = src.read();
    src.apply([{ kind: "put", key: "x", record: { id: "x" } }], r.stamps);
    expect(read(file)).toBe("- id: x\n");
  });

  test("skips everything when the file changed after it was read", () => {
    const { file, src } = setup();
    write(file, "- id: 1\n");
    const r = src.read();
    writeFileSync(file, "- id: 1\n- id: 2\n");
    const out = src.apply([{ kind: "delete", key: "1" }], r.stamps);
    expect(out.skipped).toEqual([{ key: "1", reason: "file changed during sync; will retry" }]);
    expect(read(file)).toBe("- id: 1\n- id: 2\n");
  });

  test("never overwrites a file that could not be read", () => {
    const { file, src } = setup();
    write(file, "a: 1\n");
    const r = src.read();
    const out = src.apply([{ kind: "put", key: "x", record: { id: "x" } }], r.stamps);
    expect(out.skipped).toEqual([{ key: "x", reason: "file could not be read; not modified" }]);
    expect(out.written.size).toBe(0);
    expect(read(file)).toBe("a: 1\n");
  });

  test("refuses ops on duplicate keys and leaves the file untouched", () => {
    const { file, src } = setup();
    write(file, "- id: d\n- id: d\n");
    const r = src.read();
    const out = src.apply([{ kind: "delete", key: "d" }], r.stamps);
    expect(out.skipped).toEqual([{ key: "d", reason: "file could not be read; not modified" }]);
    expect(read(file)).toBe("- id: d\n- id: d\n");
  });
});

test("table parse errors are reported on one line", () => {
  const file = join(tmpRoot(), "people.yaml");
  write(file, "- [\n");
  expect(new ListSource(file, "id").read().tableError).not.toContain("\n");
});
