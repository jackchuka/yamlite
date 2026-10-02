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
    ["refKeys", "tasks"],
    ["meta"],
  ]);
  expect(invalidationsFor(sync({ schema: [{}] }))).toContainEqual(["meta"]);
});

test("a sync without changes refetches nothing", () => {
  expect(invalidationsFor(sync({ warnings: ["a: x"] }))).toEqual([]);
});

test("reloads refetch meta, conflicts refetch the conflict list", () => {
  expect(invalidationsFor({ type: "reload", at: "t", tables: [] })).toEqual([["meta"]]);
  expect(
    invalidationsFor({ type: "conflict", at: "t", table: "tasks", key: "a", winner: "file", savedTo: null }),
  ).toEqual([["conflicts"]]);
  expect(invalidationsFor({ type: "error", at: "t", message: "x" })).toEqual([]);
});
