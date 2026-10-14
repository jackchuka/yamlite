import { expect, test } from "vitest";
import { fieldEach, fieldSql, getField, resolveField, setField } from "../src/fieldpath.ts";
import type { ColumnType } from "../src/types.ts";

const columns: Record<string, ColumnType> = { id: "TEXT", metadata: "JSON", "a.b": "TEXT", title: "TEXT" };

test("a column name is that column, before any path", () => {
  expect(resolveField("title", columns)).toEqual({ column: "title", path: [] });
  expect(resolveField("a.b", columns)).toEqual({ column: "a.b", path: [] });
  expect(resolveField("title", new Map(Object.entries(columns)))).toEqual({ column: "title", path: [] });
});

test("a dotted name is a path through a JSON column", () => {
  expect(resolveField("metadata.status", columns)).toEqual({ column: "metadata", path: ["status"] });
  expect(resolveField("metadata.x.y", columns)).toEqual({ column: "metadata", path: ["x", "y"] });
  expect(resolveField("title.x", columns)).toBeNull();
  expect(resolveField("missing.x", columns)).toBeNull();
  expect(resolveField("metadata.", columns)).toBeNull();
  expect(resolveField("metadata..x", columns)).toBeNull();
  expect(resolveField("missing", columns)).toBeNull();
});

test("sql reads the value, each yields one row per value", () => {
  expect(fieldSql("src", { column: "title", path: [] })).toBe('src."title"');
  const guarded = (col: string, path: string) => `CASE WHEN json_valid(${col}) THEN json_extract(${col}, ${path}) END`;
  expect(fieldSql("src", { column: "metadata", path: ["status", 'q"'] })).toBe(
    guarded('src."metadata"', `'$."status"."q\\""'`),
  );
  expect(fieldSql("src", { column: "metadata", path: ["it's"] })).toBe(guarded('src."metadata"', `'$."it''s"'`));
  expect(fieldEach("src", { column: "metadata", path: ["tags"] })).toBe(`json_each(src."metadata", '$."tags"')`);
  expect(fieldSql("", { column: "metadata", path: ["status"] })).toBe(guarded('"metadata"', `'$."status"'`));
  expect(fieldEach("", { column: "metadata", path: ["tags"] })).toBe(`json_each("metadata", '$."tags"')`);
});

test("get and set follow the path", () => {
  const ref = { column: "metadata", path: ["status"] };
  expect(getField({ metadata: { status: "draft" } }, ref)).toBe("draft");
  expect(getField({ metadata: null }, ref)).toBeUndefined();
  expect(getField({ title: "x" }, { column: "title", path: [] })).toBe("x");
  expect(setField({ metadata: { a: 1 } }, ref, "draft")).toEqual({ metadata: { a: 1, status: "draft" } });
  expect(setField({}, ref, "draft")).toEqual({ metadata: { status: "draft" } });
});
