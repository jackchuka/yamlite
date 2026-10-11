import { expect, test } from "vitest";
import { enoughText, groupHits, rankHits, snippet } from "./search";
import type { SearchHit } from "./types";

const hit = (over: Partial<SearchHit>): SearchHit => ({
  table: "tasks",
  key: "k",
  label: null,
  column: "title",
  value: "",
  rank: 3,
  total: 1,
  ...over,
});

test("enoughText counts characters after trimming", () => {
  expect(enoughText(" a ")).toBe(false);
  expect(enoughText("ab")).toBe(true);
  expect(enoughText("日本")).toBe(true);
});

test("snippet keeps the match and up to 30 characters either side", () => {
  const value = `${"x".repeat(40)}Alpha${"y".repeat(40)}`;
  expect(snippet(value, "alpha")).toEqual({
    before: `…${"x".repeat(30)}`,
    match: "Alpha",
    after: `${"y".repeat(30)}…`,
  });
  expect(snippet("an Alpha", "alpha")).toEqual({ before: "an ", match: "Alpha", after: "" });
});

test("snippet collapses newlines and runs of whitespace", () => {
  expect(snippet("# Title\n\nbody alpha\nnext", "alpha")).toEqual({
    before: "Title body ",
    match: "alpha",
    after: " next",
  });
});

test("snippet falls back to the start of the value when the match is not found", () => {
  expect(snippet("nothing here", "zz")).toEqual({ before: "", match: "", after: "nothing here" });
});

test("rankHits orders by rank, then fuzzy score, then table and key", () => {
  const hits = [
    hit({ table: "b", key: "x2", rank: 3, value: "has alpha inside" }),
    hit({ table: "b", key: "x1", rank: 3, value: "alpha first" }),
    hit({ table: "a", key: "alpha", rank: 0, value: "alpha" }),
    hit({ table: "a", key: "alphabet", rank: 1, value: "alphabet" }),
  ];
  expect(rankHits(hits, "alpha").map((h) => h.key)).toEqual(["alpha", "alphabet", "x1", "x2"]);
});

test("groupHits orders tables by their best hit and keeps totals", () => {
  const hits = [
    hit({ table: "tasks", key: "t1", rank: 3, value: "about alpha", total: 4 }),
    hit({ table: "projects", key: "alpha", rank: 0, value: "alpha", total: 1 }),
    hit({ table: "tasks", key: "alpha", rank: 0, value: "alpha", total: 4 }),
  ];
  expect(groupHits(hits, "alpha")).toEqual([
    { table: "projects", total: 1, hits: [hits[1]] },
    { table: "tasks", total: 4, hits: [hits[2], hits[0]] },
  ]);
});

test("snippet drops markdown heading, list and quote markers", () => {
  expect(snippet("## Plan\n- first alpha\n> quoted", "alpha")).toEqual({
    before: "Plan first ",
    match: "alpha",
    after: " quoted",
  });
});

test("snippet takes a shorter lead-in where space is tight", () => {
  expect(snippet(`${"x".repeat(40)}alpha`, "alpha", 10)).toEqual({
    before: `…${"x".repeat(10)}`,
    match: "alpha",
    after: "",
  });
});
