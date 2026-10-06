import { expect, test } from "vitest";
import { diffJson, MAX_LCS_CELLS } from "./jsondiff";

test("equal values have no changes", () => {
  expect(diffJson({ a: [1, 2], b: { c: "x" } }, { b: { c: "x" }, a: [1, 2] })).toEqual([]);
});

test("object keys are added, removed and changed recursively", () => {
  expect(diffJson({ a: 1, b: { c: 1, d: 2 }, gone: true }, { a: 1, b: { c: 2, d: 2 }, new: "x" })).toEqual([
    { path: "b › c", kind: "changed", before: 1, after: 2 },
    { path: "gone", kind: "removed", before: true },
    { path: "new", kind: "added", after: "x" },
  ]);
});

test("arrays of primitives are a leaf", () => {
  expect(diffJson({ tags: ["a", "b"] }, { tags: ["a", "b", "c"] })).toEqual([
    { path: "tags", kind: "changed", before: ["a", "b"], after: ["a", "b", "c"] },
  ]);
});

test("keyed arrays match by an auto-detected identity field", () => {
  const before = {
    items: [
      { question: "Q-1", note: "a" },
      { question: "Q-2", note: "b" },
      { question: "Q-3", note: "c" },
    ],
  };
  const after = {
    items: [
      { question: "Q-1", note: "a" },
      { question: "Q-2", note: "B" },
      { question: "Q-4", note: "d" },
    ],
  };
  expect(diffJson(before, after)).toEqual([
    { path: "items › Q-2 › note", kind: "changed", before: "b", after: "B" },
    { path: "items › Q-3", kind: "removed", before: { question: "Q-3", note: "c" } },
    { path: "items › Q-4", kind: "added", after: { question: "Q-4", note: "d" } },
  ]);
});

test("id is preferred over other identity fields", () => {
  const r = diffJson(
    [{ id: 1, code: "x" }],
    [
      { id: 1, code: "y" },
      { id: 2, code: "z" },
    ],
  );
  expect(r.map((c) => c.path)).toEqual(["1 › code", "2"]);
});

test("duplicate or missing identity values fall back to positions", () => {
  const r = diffJson(
    [
      { k: 1, v: 1 },
      { k: 1, v: 1 },
    ],
    [
      { k: 1, v: 1 },
      { k: 1, v: 2 },
    ],
  );
  expect(r).toEqual([{ path: "[1] › v", kind: "changed", before: 1, after: 2 }]);
});

test("unkeyed arrays of equal length compare by index", () => {
  expect(diffJson([{ a: 1 }, { b: 2 }], [{ a: 1 }, { b: 3 }])).toEqual([
    { path: "[1] › b", kind: "changed", before: 2, after: 3 },
  ]);
});

test("unkeyed arrays with an insertion report only the inserted element", () => {
  const a = { x: 1 },
    b = { y: 2 },
    c = { z: 3 },
    n = { w: 9 };
  expect(diffJson([a, b, c], [a, n, b, c])).toEqual([{ path: "[1]", kind: "added", after: n }]);
});

test("a unique free-text field is not used as the identity", () => {
  const r = diffJson(
    [
      { note: "first memo", tag: "x" },
      { note: "second memo", tag: "x" },
    ],
    [
      { note: "edited memo", tag: "x" },
      { note: "second memo", tag: "x" },
    ],
  );
  expect(r).toEqual([{ path: "[0] › note", kind: "changed", before: "first memo", after: "edited memo" }]);
});

test("editing a note under an id identity is one change", () => {
  const r = diffJson(
    [
      { id: "a", note: "one" },
      { id: "b", note: "two" },
    ],
    [
      { id: "a", note: "one" },
      { id: "b", note: "2" },
    ],
  );
  expect(r).toEqual([{ path: "b › note", kind: "changed", before: "two", after: "2" }]);
});

test("identity values of mixed types are rejected", () => {
  const r = diffJson(
    [
      { id: 1, v: "x" },
      { id: "2", v: "x" },
    ],
    [
      { id: 1, v: "x" },
      { id: "2", v: "z" },
    ],
  );
  expect(r.map((c) => c.path)).toEqual(["[1] › v"]);
});

test("common prefix and suffix are trimmed before matching", () => {
  const items = ["a", "b", "c", "d", "e"].map((x) => ({ [x]: x }));
  const after = [...items.slice(0, 2), { n: 1 }, ...items.slice(2)];
  expect(diffJson(items, after)).toEqual([{ path: "[2]", kind: "added", after: { n: 1 } }]);
});

test("a huge unmatched middle is reported as one change", () => {
  const n = Math.ceil(Math.sqrt(MAX_LCS_CELLS)) + 1;
  const a = Array.from({ length: n }, (_, i) => ({ [`a${i}`]: i }));
  const b = Array.from({ length: n + 1 }, (_, i) => ({ [`b${i}`]: i }));
  const r = diffJson(a, b);
  expect(r).toHaveLength(1);
  expect(r[0]).toMatchObject({ path: "", kind: "changed" });
});
