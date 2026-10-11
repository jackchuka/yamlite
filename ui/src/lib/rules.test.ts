import { expect, test } from "vitest";
import { boundKind, ruleSummary, rulesOf, warningsFor } from "./rules";

const meta = {
  required: ["title"],
  values: { status: ["todo", "done"] },
  formats: { due: "date" as const },
  min: { priority: 1 },
  max: { priority: 5 },
  references: [
    { column: "owner", table: "people" },
    { column: "project", table: "projects", target: "slug" },
  ],
};

test("rules keep references as written", () => {
  expect(rulesOf(meta).references).toEqual({ owner: "people", project: "projects.slug" });
});

test("a column's rules in short", () => {
  const r = rulesOf(meta);
  expect(ruleSummary(r, "title")).toEqual(["required"]);
  expect(ruleSummary(r, "status")).toEqual(["values 2"]);
  expect(ruleSummary(r, "priority")).toEqual(["1 – 5"]);
  expect(ruleSummary(r, "owner")).toEqual(["→ people"]);
  expect(ruleSummary(r, "due")).toEqual(["date"]);
});

test("warnings are matched to their column, views by prefix", () => {
  const w = ['status "wip" not in values (b)', "title missing (b)", 'tasks__subs: status "x" not in values (a)'];
  expect(warningsFor("status", w)).toEqual(['status "wip" not in values (b)']);
  expect(warningsFor("status", w, "tasks__subs")).toEqual(['tasks__subs: status "x" not in values (a)']);
});

test("bounds exist only for numbers, dates and datetimes", () => {
  expect(boundKind("INTEGER", undefined)).toBe("number");
  expect(boundKind("TEXT", "date")).toBe("date");
  expect(boundKind("TEXT", undefined)).toBeNull();
  expect(boundKind("BOOLEAN", undefined)).toBeNull();
});
