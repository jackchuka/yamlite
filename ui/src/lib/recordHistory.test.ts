import { expect, test } from "vitest";
import { historyCount, restoreDraft, since, valueText } from "./recordHistory";
import type { HistoryEntry } from "./types";

const now = Date.parse("2026-10-06T12:00:00Z");

test("since", () => {
  expect(since("2026-10-06T11:59:30Z", now)).toBe("just now");
  expect(since("2026-10-06T11:56:00Z", now)).toBe("4 minutes ago");
  expect(since("2026-10-06T10:00:00Z", now)).toBe("2 hours ago");
  expect(since("2026-10-03T12:00:00Z", now)).toBe("3 days ago");
  expect(since("2026-08-01T00:00:00Z", now)).toBe("2026-08-01");
});

test("valueText", () => {
  expect(valueText(null)).toBe("(none)");
  expect(valueText("x")).toBe("x");
  expect(valueText(["a", "b"])).toBe('["a","b"]');
  expect(valueText(false)).toBe("false");
});

test("restoreDraft: old values in, fields the old version lacks cleared, key kept", () => {
  expect(
    restoreDraft({ id: "a", title: "new", meta: { x: 1 } }, { id: "renamed", title: "old", tags: ["t"] }, "id"),
  ).toEqual({ id: "a", title: "old", meta: null, tags: ["t"] });
});

test("restoreDraft keeps a field named __proto__ as a field", () => {
  const record = JSON.parse('{"__proto__": {"polluted": true}, "title": "x"}') as Record<string, unknown>;
  const out = restoreDraft({ id: "a", title: "y" }, record, "id");
  expect(Object.getPrototypeOf(out)).toBe(Object.prototype);
  expect(Object.hasOwn(out, "__proto__")).toBe(true);
  expect(({} as Record<string, unknown>).polluted).toBeUndefined();
});

const entry = (kind: "wip" | "commit"): HistoryEntry => ({
  kind,
  sha: kind === "wip" ? null : "a".repeat(40),
  head: false,
  subject: null,
  author: null,
  date: "2026-10-06T00:00:00Z",
  path: "tasks/a.yaml",
  changes: [],
  record: null,
});

test("historyCount counts commits, with + while more remain", () => {
  expect(historyCount(undefined)).toBeNull();
  expect(historyCount([{ state: "nogit" }])).toBeNull();
  expect(historyCount([{ state: "ok", entries: [entry("wip"), entry("commit")], next: null }])).toBe("1");
  expect(historyCount([{ state: "ok", entries: [entry("commit")], next: "50" }])).toBe("1+");
});
