import { describe, expect, test } from "vitest";
import { crossEqual, decode, encode, mismatches, recordToRow, rowToRecord } from "../src/codec.ts";
import type { ColumnType } from "../src/types.ts";

describe("encode", () => {
  test.each([
    [true, 1n],
    [false, 0n],
    [5n, 5n],
    [1.5, 1.5],
    ["x", "x"],
    [null, null],
    [undefined, null],
    [{ a: 1n, b: [2n ** 60n] }, '{"a":1,"b":["1152921504606846976"]}'],
  ])("encode(%o) = %o", (value, encoded) => {
    expect(encode(value)).toEqual(encoded);
  });
});

describe("decode", () => {
  test.each([
    [1n, "BOOLEAN", true],
    [0, "BOOLEAN", false],
    [2n, "BOOLEAN", 2],
    [5n, "INTEGER", 5],
    [2n ** 60n, "INTEGER", 2n ** 60n],
    ['{"a":1}', "JSON", { a: 1 }],
    ["nope", "JSON", "nope"],
    ['"s"', "JSON", '"s"'],
    ["x", "TEXT", "x"],
    [null, "TEXT", null],
  ])("decode(%o, %s) = %o", (value, type, decoded) => {
    expect(decode(value as never, type as ColumnType)).toEqual(decoded);
  });
});

describe("records", () => {
  const types = new Map<string, ColumnType>([
    ["id", "TEXT"],
    ["done", "BOOLEAN"],
    ["tags", "JSON"],
    ["n", "INTEGER"],
  ]);

  test("recordToRow encodes every field", () => {
    expect(recordToRow({ done: true, tags: ["a"], n: 3n })).toEqual({ done: 1n, tags: '["a"]', n: 3n });
  });

  test("rowToRecord decodes, omits the key and nulls", () => {
    expect(rowToRecord({ id: "a", done: 1n, tags: '["a"]', n: null }, types, "id")).toEqual({
      done: true,
      tags: ["a"],
    });
  });

  test("crossEqual compares logical values", () => {
    const db = (row: Record<string, never>) => rowToRecord(row, types, "id");
    expect(
      crossEqual({ done: true, tags: ["a"], n: 3n }, db({ id: "a", done: 1n, tags: '["a"]', n: 3n } as never), types),
    ).toBe(true);
    expect(crossEqual({ n: 1n }, db({ n: 2n } as never), types)).toBe(false);
    expect(crossEqual({ a: null }, {}, types)).toBe(true);
    const text = new Map<string, ColumnType>([["v", "TEXT"]]);
    expect(crossEqual({ v: 1n }, { v: "1" }, text)).toBe(true);
    expect(crossEqual({ v: true }, { v: "1" }, text)).toBe(true);
    expect(crossEqual({ v: 1.5 }, { v: "1.5" }, text)).toBe(true);
    expect(crossEqual({ v: 1n }, { v: "2" }, text)).toBe(false);
    expect(crossEqual({ v: 1n }, { v: " 1" }, text)).toBe(false);
    expect(crossEqual({ v: 1.5 }, { v: "1.50" }, text)).toBe(false);
    expect(crossEqual({ v: 1.5 }, { v: "01.5" }, text)).toBe(false);
    expect(crossEqual({ v: 1 }, { v: "1.0" }, text)).toBe(true);
    expect(crossEqual({ v: 1e21 }, { v: "1.0e+21" }, text)).toBe(true);
    expect(crossEqual({ v: 1e-7 }, { v: "1.0e-07" }, text)).toBe(true);
  });

  test("mismatches lists fields whose value does not fit the column", () => {
    expect(mismatches({ done: "maybe", n: 3n, other: 1 }, types)).toEqual(["done"]);
  });
});
