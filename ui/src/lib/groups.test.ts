import { expect, test } from "vitest";
import { groupNames, groupTables } from "./groups";

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
