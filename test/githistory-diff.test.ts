import { expect, test } from "vitest";
import { fieldChanges } from "../src/githistory.ts";

test("changed, added and removed fields", () => {
  expect(fieldChanges({ a: 1n, b: "x", c: true }, { a: 2n, c: true, d: "new" })).toEqual([
    { path: "a", from: 1n, to: 2n },
    { path: "d", from: null, to: "new" },
    { path: "b", from: "x", to: null },
  ]);
});

test("maps are walked, lists are compared whole", () => {
  expect(
    fieldChanges(
      { meta: { owner: "bob", links: ["a"] }, tags: ["x", "y"] },
      { meta: { owner: "amy", links: ["a"] }, tags: ["y", "x"] },
    ),
  ).toEqual([
    { path: "meta.owner", from: "bob", to: "amy" },
    { path: "tags", from: ["x", "y"], to: ["y", "x"] },
  ]);
});

test("a key with a dot or bracket is quoted", () => {
  expect(fieldChanges({ m: { "a.b": 1n } }, { m: { "a.b": 2n } })).toEqual([{ path: 'm["a.b"]', from: 1n, to: 2n }]);
  expect(fieldChanges({ "x.y": 1n }, {})).toEqual([{ path: '["x.y"]', from: 1n, to: null }]);
});

test("a type change is one change of that field", () => {
  expect(fieldChanges({ title: "T" }, { title: { en: "T" } })).toEqual([{ path: "title", from: "T", to: { en: "T" } }]);
});

test("null and a missing field are the same; numbers compare like the engine", () => {
  expect(fieldChanges({ a: null, n: 1n }, { n: 1 })).toEqual([]);
  expect(fieldChanges(null, null)).toEqual([]);
  expect(fieldChanges(null, { a: "x" })).toEqual([{ path: "a", from: null, to: "x" }]);
});

test("a field named __proto__ is an ordinary field", () => {
  const after = JSON.parse('{"__proto__": "x"}') as Record<string, unknown>;
  expect(fieldChanges({}, after)).toEqual([{ path: "__proto__", from: null, to: "x" }]);
});
