import { expect, test } from "vitest";
import { cellView } from "./cell";

test("scalars", () => {
  expect(cellView(null, "TEXT")).toEqual({ kind: "null" });
  expect(cellView(undefined, "TEXT")).toEqual({ kind: "null" });
  expect(cellView(true, "BOOLEAN")).toEqual({ kind: "bool", value: true });
  expect(cellView(3, "INTEGER")).toEqual({ kind: "number", text: "3" });
  expect(cellView("9007199254740993", "INTEGER")).toEqual({ kind: "number", text: "9007199254740993" });
  expect(cellView("hi", "TEXT")).toEqual({ kind: "text", text: "hi" });
  expect(cellView("a\nb", "TEXT")).toEqual({ kind: "text", text: "a ⏎ b" });
});

test("a list of scalars is chips, cut after three", () => {
  expect(cellView(["a", "b"], "JSON")).toEqual({ kind: "chips", items: ["a", "b"], more: 0 });
  expect(cellView(["a", "b", "c", "d", "e"], "JSON")).toEqual({ kind: "chips", items: ["a", "b", "c"], more: 2 });
  expect(cellView([1, true], "JSON")).toEqual({ kind: "chips", items: ["1", "true"], more: 0 });
});

test("a flat map previews its first two entries", () => {
  expect(cellView({ ja: "牛乳を買う", en: "Buy milk" }, "JSON")).toEqual({
    kind: "map",
    entries: [
      ["ja", "牛乳を買う"],
      ["en", "Buy milk"],
    ],
    more: 0,
  });
  expect(cellView({ a: 1, b: 2, c: 3 }, "JSON")).toMatchObject({ kind: "map", more: 1 });
});

test("nested values show a size badge and a key preview", () => {
  expect(cellView({ owner: "alice", due: "2026-10-10", links: ["x", "y"] }, "JSON")).toEqual({
    kind: "nested",
    label: "{3}",
    preview: "owner, due, links[2]",
  });
  expect(cellView([{ a: 1 }, { a: 2 }], "JSON")).toEqual({ kind: "nested", label: "[2]", preview: "{1}, {1}" });
  expect(cellView({}, "JSON")).toEqual({ kind: "nested", label: "{0}", preview: "" });
});

test("a markdown column shows its text without the markup", () => {
  const body = [
    'import { Callout } from "./Callout";',
    "",
    "# Hello world",
    "",
    "This post uses **MDX** and `code`,",
    "with a [link](https://example.com).",
    "",
    '<Callout type="warning">',
    "  Be careful.",
    "</Callout>",
    "",
    "```ts",
    "const x = 1;",
    "```",
    "",
    "- [x] done",
    "- todo",
    "",
    "| a | b |",
    "|---|---|",
    "| 1 | 2 |",
  ].join("\n");
  expect(cellView(body, "TEXT", "markdown")).toEqual({
    kind: "text",
    text: "Hello world · This post uses MDX and code, with a link. · Be careful. · done · todo · a b · 1 2",
  });
});

test("snake_case and prose that starts with Export are left alone", () => {
  expect(cellView("Export the file_name_here\n", "TEXT", "markdown")).toEqual({
    kind: "text",
    text: "Export the file_name_here",
  });
});
