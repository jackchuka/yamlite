import { expect, test } from "vitest";
import { inferColumns, inferType, logicalType, matchesType, mergeType } from "../src/schema.ts";
import type { ColumnType } from "../src/types.ts";

test.each([
  [true, "BOOLEAN"],
  [1n, "INTEGER"],
  [1.5, "REAL"],
  ["s", "TEXT"],
  [{ a: 1 }, "JSON"],
  [[1], "JSON"],
  [null, null],
])("inferType(%o) = %s", (value, type) => {
  expect(inferType(value)).toBe(type);
});

test.each([
  [null, "INTEGER", "INTEGER"],
  ["INTEGER", null, "INTEGER"],
  ["INTEGER", "INTEGER", "INTEGER"],
  ["INTEGER", "REAL", "REAL"],
  ["REAL", "INTEGER", "REAL"],
  ["INTEGER", "TEXT", "TEXT"],
  ["BOOLEAN", "INTEGER", "TEXT"],
  ["JSON", "TEXT", "TEXT"],
])("mergeType(%s, %s) = %s", (a, b, type) => {
  expect(mergeType(a as ColumnType | null, b as ColumnType | null)).toBe(type);
});

test("inferColumns merges across records and defaults null-only columns to TEXT", () => {
  const columns = inferColumns([
    { a: 1n, b: null, c: true },
    { a: 2.5, c: false, d: "x" },
  ]);
  expect(Object.fromEntries(columns)).toEqual({ a: "REAL", b: "TEXT", c: "BOOLEAN", d: "TEXT" });
});

test.each([
  ["INTEGER", "INTEGER"],
  ["int", "INTEGER"],
  ["BIGINT", "INTEGER"],
  ["BOOLEAN", "BOOLEAN"],
  ["JSON", "JSON"],
  ["REAL", "REAL"],
  ["DOUBLE PRECISION", "REAL"],
  ["VARCHAR(20)", "TEXT"],
  ["", "TEXT"],
  ["ANY", "TEXT"],
  ["BLOB", "TEXT"],
])("logicalType(%s) = %s", (declared, type) => {
  expect(logicalType(declared)).toBe(type);
});

test("matchesType", () => {
  expect(matchesType(1n, "REAL")).toBe(true);
  expect(matchesType("x", "BOOLEAN")).toBe(false);
  expect(matchesType(null, "INTEGER")).toBe(true);
  expect(matchesType({ a: 1 }, "JSON")).toBe(true);
});
