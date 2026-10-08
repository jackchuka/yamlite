import { act, renderHook } from "@testing-library/react";
import { beforeEach, expect, test } from "vitest";
import { groupNames, groupTables, useStoredSet } from "./groups";

const t = (name: string, group: string | null = null) => ({ name, group });

test("ungrouped tables come first, then groups in the order they first appear", () => {
  const sections = groupTables([t("a", "CRM"), t("b"), t("c", "Work"), t("d", "CRM"), t("e")]);
  expect(sections.map((s) => [s.group, s.tables.map((x) => x.name)])).toEqual([
    [null, ["b", "e"]],
    ["CRM", ["a", "d"]],
    ["Work", ["c"]],
  ]);
});

test("no tables, no sections; no ungrouped tables, no ungrouped section", () => {
  expect(groupTables([])).toEqual([]);
  expect(groupTables([t("a", "X")]).map((s) => s.group)).toEqual(["X"]);
});

test("group names are listed once, in order", () => {
  expect(groupNames([t("a", "CRM"), t("b"), t("c", "Work"), t("d", "CRM")])).toEqual(["CRM", "Work"]);
});

beforeEach(() => localStorage.clear());

test("a stored set toggles names, keeps them per key and across mounts", () => {
  const a = renderHook(() => useStoredSet("k-a"));
  act(() => a.result.current[1]("x"));
  expect([...a.result.current[0]]).toEqual(["x"]);
  expect([...renderHook(() => useStoredSet("k-a")).result.current[0]]).toEqual(["x"]);
  expect([...renderHook(() => useStoredSet("k-b")).result.current[0]]).toEqual([]);
  act(() => a.result.current[1]("x"));
  expect([...a.result.current[0]]).toEqual([]);
});
