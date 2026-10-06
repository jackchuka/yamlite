import { expect, test } from "vitest";
import { formatAgo, formatNumber, formatWhen } from "./format";

const ja = () => localStorage.setItem("yamlite-locale", "ja");

const now = Date.parse("2026-10-06T12:00:00Z");

test("relative time follows the locale", () => {
  expect(formatAgo("2026-10-06T11:59:57Z", now)).toBe("3 seconds ago");
  expect(formatAgo("2026-10-06T11:58:00Z", now)).toBe("2 minutes ago");
  ja();
  expect(formatAgo("2026-10-06T11:59:57Z", now)).toBe("3 秒前");
});

test("no timestamp shows a dash", () => {
  expect(formatAgo(null, now)).toBe("—");
});

test("today shows only the time, other days add the date", () => {
  const today = new Date(2026, 9, 6, 15, 0);
  expect(formatWhen(new Date(2026, 9, 6, 9, 5).toISOString(), today)).toMatch(/^0?9:05/);
  ja();
  expect(formatWhen(new Date(2026, 9, 1, 9, 5).toISOString(), today)).toBe("10/1 09:05");
});

test("numbers use locale grouping", () => {
  expect(formatNumber(12345)).toBe("12,345");
});
