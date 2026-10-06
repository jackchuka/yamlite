import { expect, test } from "vitest";
import { buildPatch, changedFields, emptyValueFor, fieldKind, fieldProblem, removeIn, setIn } from "./form";

test("field kinds follow the value and the column type", () => {
  expect(fieldKind(true, "BOOLEAN", false)).toBe("switch");
  expect(fieldKind(3, "INTEGER", false)).toBe("number");
  expect(fieldKind(1.5, "REAL", false)).toBe("number");
  expect(fieldKind("9007199254740993", "INTEGER", false)).toBe("bigint");
  expect(fieldKind("hi", "TEXT", false)).toBe("text");
  expect(fieldKind("line\nline", "TEXT", false)).toBe("textarea");
  expect(fieldKind("x".repeat(81), "TEXT", false)).toBe("textarea");
  expect(fieldKind("p1", "TEXT", true)).toBe("ref");
  expect(fieldKind(null, "TEXT", false)).toBe("unset");
  expect(fieldKind(["a", "b"], "JSON", false)).toBe("chips");
  expect(fieldKind([1, 2], "JSON", false)).toBe("json");
  expect(fieldKind({ ja: "a", en: "b" }, "JSON", false)).toBe("map");
  expect(fieldKind({ owner: "a", links: ["x"], deep: { a: true } }, "JSON", false)).toBe("map");
  expect(fieldKind({ list: [{ a: 1 }] }, "JSON", false)).toBe("json");
  expect(fieldKind([{ a: 1 }], "JSON", false)).toBe("json");
  expect(fieldKind("a", undefined, false)).toBe("text");
  expect(fieldKind(2, undefined, false)).toBe("number");
});

test("a markdown column gets the markdown editor whatever its length", () => {
  expect(fieldKind("hi", "TEXT", false, "markdown")).toBe("markdown");
  expect(fieldKind("# a\n\nb", "TEXT", false, "markdown")).toBe("markdown");
  expect(fieldKind(null, "TEXT", false, "markdown")).toBe("unset");
  // a value the file holds as something other than text keeps its own widget
  expect(fieldKind(3, "TEXT", false, "markdown")).toBe("number");
});

test("empty values for unset fields", () => {
  expect(emptyValueFor("BOOLEAN")).toBe(false);
  expect(emptyValueFor("INTEGER")).toBe(0);
  expect(emptyValueFor("TEXT")).toBe("");
  expect(emptyValueFor("JSON")).toEqual({});
});

test("setIn and removeIn copy instead of mutating", () => {
  const value = { title: { ja: "a", en: "b" }, links: ["x", "y"] };
  const next = setIn(value, ["title", "ja"], "z") as typeof value;
  expect(next.title.ja).toBe("z");
  expect(value.title.ja).toBe("a");
  expect(setIn(value, ["links", 1], "w")).toEqual({ title: { ja: "a", en: "b" }, links: ["x", "w"] });
  expect(removeIn(value, ["title", "en"])).toEqual({ title: { ja: "a" }, links: ["x", "y"] });
  expect(removeIn(value, ["links", 0])).toEqual({ title: { ja: "a", en: "b" }, links: ["y"] });
});

test("only changed fields are sent, with their loaded values as the base", () => {
  const base = { id: "a", title: { ja: "a", en: "b" }, done: false, note: "n" };
  const draft = { ...base, title: { en: "b", ja: "a" }, done: true, note: null, prio: 2 };
  expect(changedFields(base, draft)).toEqual(["done", "note", "prio"]);
  expect(buildPatch(base, draft)).toEqual({
    values: { done: true, note: null, prio: 2 },
    base: { done: false, note: "n", prio: null },
  });
});

test("editing and undoing leaves nothing to save", () => {
  const base = { id: "a", meta: { links: ["x"], owner: "al" } };
  const edited = setIn(base, ["meta", "owner"], "bo") as typeof base;
  const undone = setIn(edited, ["meta", "owner"], "al") as typeof base;
  expect(changedFields(base, undone)).toEqual([]);
});

test("date and datetime formats pick a picker, also for a missing value; anything else is text", () => {
  expect(fieldKind("2026-10-06", "TEXT", false, "date")).toBe("date");
  expect(fieldKind(null, "TEXT", false, "date")).toBe("date");
  expect(fieldKind("2026-02-31", "TEXT", false, "date")).toBe("text");
  expect(fieldKind("2026-10-06T09:00+09:00", "TEXT", false, "datetime")).toBe("datetime");
  expect(fieldKind(undefined, "TEXT", false, "datetime")).toBe("datetime");
  expect(fieldKind("yesterday", "TEXT", false, "datetime")).toBe("text");
});

test("fieldProblem names a broken format or a value out of bounds, and nothing for an empty value", () => {
  expect(fieldProblem("2026-02-31", "date", undefined, undefined)).toBe("not a date");
  expect(fieldProblem(7, undefined, 1, 5)).toBe("above max 5");
  expect(fieldProblem("2025-12-31", "date", "2026-01-01", undefined)).toBe("below min 2026-01-01");
  expect(fieldProblem(null, "date", "2026-01-01", undefined)).toBe(null);
  expect(fieldProblem(3, undefined, 1, 5)).toBe(null);
});
