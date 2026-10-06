import { expect, test } from "vitest";
import { invalidationsFor } from "./invalidate";

const sync = (over: object) => ({
  type: "sync" as const,
  at: "t",
  table: "tasks",
  ok: true,
  changes: [],
  warnings: [],
  schema: [],
  ...over,
});

test("hello refetches everything", () => {
  expect(invalidationsFor({ type: "hello" })).toEqual([[]]);
});

test("a sync with changes refetches that table's rows and records and the counts", () => {
  expect(invalidationsFor(sync({ changes: [{ key: "a", op: "toDb" }] }))).toEqual([
    ["rows", "tasks"],
    ["record", "tasks"],
    ["history", "tasks"],
    ["refKeys", "tasks"],
    ["schema"],
    ["meta"],
  ]);
  expect(invalidationsFor(sync({ schema: [{}] }))).toContainEqual(["meta"]);
});

test("a sync without changes refetches nothing", () => {
  expect(invalidationsFor(sync({ warnings: ["a: x"] }))).toEqual([]);
});

test("reloads refetch meta, conflicts refetch the conflict list", () => {
  expect(invalidationsFor({ type: "reload", at: "t", tables: [] })).toEqual([["meta"], ["page"]]);
  expect(
    invalidationsFor({ type: "conflict", at: "t", table: "tasks", key: "a", winner: "file", savedTo: null }),
  ).toEqual([["conflicts"]]);
  expect(invalidationsFor({ type: "error", at: "t", message: "x" })).toEqual([]);
});

test("a saved page reloads only that page; a config reload reloads every page", () => {
  expect(invalidationsFor({ type: "page", at: "", pages: ["board", "copy"] })).toEqual([
    ["page", "board"],
    ["page", "copy"],
  ]);
  expect(invalidationsFor({ type: "reload", at: "", tables: [] })).toEqual([["meta"], ["page"]]);
});
