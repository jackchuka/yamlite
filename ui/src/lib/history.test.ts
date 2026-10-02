import { beforeEach, expect, test } from "vitest";
import { loadHistory, pushHistory } from "./history";

beforeEach(() => localStorage.clear());

test("newest first, without duplicates, at most 50", () => {
  pushHistory("select 1");
  pushHistory("select 2");
  pushHistory("select 1");
  expect(loadHistory()).toEqual(["select 1", "select 2"]);
  for (let i = 0; i < 60; i++) pushHistory(`select ${i + 10}`);
  expect(loadHistory()).toHaveLength(50);
  expect(loadHistory()[0]).toBe("select 69");
});

test("broken storage reads as empty", () => {
  localStorage.setItem("yamlite-sql-history", "{nope");
  expect(loadHistory()).toEqual([]);
});
