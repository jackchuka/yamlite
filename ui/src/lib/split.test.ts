import { expect, test } from "vitest";
import type { SplitMeta, TableMeta } from "./types";
import { isSplitActive, seedKey, seedValues, splitFilter } from "./split";

const scalar: SplitMeta = { column: "type", json: false, items: [] };
const json: SplitMeta = { column: "tags", json: true, items: [] };

test("a scalar value filters with eq, a JSON element with has, the empty item with null", () => {
  expect(splitFilter(scalar, { value: "idea", count: 1 })).toEqual({ col: "type", op: "eq", value: "idea" });
  expect(splitFilter(scalar, { value: false, count: 1 })).toEqual({ col: "type", op: "eq", value: false });
  expect(splitFilter(json, { value: "a", count: 1 })).toEqual({ col: "tags", op: "has", value: "a" });
  expect(splitFilter(json, { value: null, count: 1 })).toEqual({ col: "tags", op: "null" });
});

test("an item is active only when its filter is the only one", () => {
  const item = { value: "idea", count: 1 };
  expect(isSplitActive([{ col: "type", op: "eq", value: "idea" }], scalar, item)).toBe(true);
  expect(isSplitActive([], scalar, item)).toBe(false);
  expect(isSplitActive([{ col: "type", op: "eq", value: "todo" }], scalar, item)).toBe(false);
  expect(
    isSplitActive(
      [
        { col: "type", op: "eq", value: "idea" },
        { col: "title", op: "contains", value: "x" },
      ],
      scalar,
      item,
    ),
  ).toBe(false);
  expect(isSplitActive([{ col: "type", op: "null" }], scalar, { value: null, count: 1 })).toBe(true);
});

const table = { key: "id", columns: { id: "TEXT", type: "TEXT", tags: "JSON" } } as unknown as TableMeta;

test("eq and has filters on the table's non-key columns seed a new record", () => {
  expect(
    seedValues(table, [
      { col: "type", op: "eq", value: "idea" },
      { col: "tags", op: "has", value: "a" },
      { col: "id", op: "eq", value: "x" },
      { col: "type", op: "null" },
      { col: "missing", op: "eq", value: 1 },
    ]),
  ).toEqual({ type: "idea", tags: ["a"] });
  expect(seedValues(table, [])).toEqual({});
});

const notes = {
  key: "id",
  columns: { id: "TEXT", team: "TEXT", project: "TEXT", metadata: "JSON" },
  captures: [
    { column: "team", segment: 0 },
    { column: "project", segment: 1 },
  ],
} as unknown as TableMeta;

test("eq filters on leading captures seed the key", () => {
  expect(seedKey(notes, [{ col: "team", op: "eq", value: "platform" }])).toBe("platform/");
  expect(
    seedKey(notes, [
      { col: "project", op: "eq", value: "search" },
      { col: "team", op: "eq", value: "platform" },
    ]),
  ).toBe("platform/search/");
  expect(seedKey(notes, [{ col: "project", op: "eq", value: "search" }])).toBe("");
  const gap = { ...notes, captures: [{ column: "team", segment: 1 }] } as TableMeta;
  expect(seedKey(gap, [{ col: "team", op: "eq", value: "platform" }])).toBe("");
  expect(seedKey(table, [])).toBe("");
});

test("captures are not seeded as values; field paths seed their nested map", () => {
  expect(
    seedValues(notes, [
      { col: "team", op: "eq", value: "platform" },
      { col: "metadata.status", op: "has", value: "draft" },
      { col: "metadata.owner", op: "eq", value: "ana" },
    ]),
  ).toEqual({ metadata: { status: "draft", owner: "ana" } });
});
