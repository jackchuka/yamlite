import { describe, expect, test } from "vitest";
import { formatDatetime, instant, isDate, isDatetime, parseDatetime } from "../src/datetime.ts";
import { boundProblem, formatProblem } from "../src/rules.ts";

describe("isDate", () => {
  test.each(["2026-10-06", "2028-02-29", "2000-02-29", "0001-01-01"])("%s is a date", (s) => {
    expect(isDate(s)).toBe(true);
  });
  test.each([
    "2026-02-29",
    "1900-02-29",
    "2026-04-31",
    "2026-13-01",
    "2026-00-10",
    "2026-1-6",
    "2026-10-06T00:00",
    20261006,
    null,
  ])("%s is not a date", (s) => {
    expect(isDate(s)).toBe(false);
  });
});

describe("parseDatetime", () => {
  test("keeps every part as written", () => {
    expect(parseDatetime("2026-10-06T09:05:30.25+09:00")).toEqual({
      date: "2026-10-06",
      sep: "T",
      hour: "09",
      minute: "05",
      second: "30",
      fraction: "25",
      offset: "+09:00",
    });
    expect(parseDatetime("2026-10-06 09:05")).toEqual({
      date: "2026-10-06",
      sep: " ",
      hour: "09",
      minute: "05",
      second: null,
      fraction: null,
      offset: null,
    });
  });
  test.each(["2026-10-06T09:05Z", "2026-10-06T23:59:59.123456789-05:30", "2026-10-06T00:00:00"])(
    "%s is a datetime",
    (s) => {
      expect(isDatetime(s)).toBe(true);
      expect(formatDatetime(parseDatetime(s)!)).toBe(s);
    },
  );
  test.each([
    "2026-10-06",
    "2026-10-06T24:00",
    "2026-10-06T23:60",
    "2026-10-06T23:59:60",
    "2026-10-06T09:00+0900",
    "2026-10-06T09:00+24:00",
    "2026-02-30T09:00",
    "2026-10-06T9:00",
    "2026-10-06T09:00:00.",
  ])("%s is not a datetime", (s) => {
    expect(isDatetime(s)).toBe(false);
  });
});

describe("instant", () => {
  test("offsets are compared as points in time; no offset is UTC; a date is midnight UTC", () => {
    expect(instant("2026-01-01T08:00:00+09:00")).toBe(instant("2025-12-31T23:00:00Z"));
    expect(instant("2026-01-01T00:00")).toBe(instant("2026-01-01"));
    expect(instant("2026-01-01T00:00:00.5Z")).toBe(Date.UTC(2026, 0, 1, 0, 0, 0, 500));
    expect(instant("not a date")).toBe(null);
  });
});

describe("formatProblem", () => {
  test("a value that is not the format's string is a problem", () => {
    expect(formatProblem("2026-02-31", "date")).toBe("not a date");
    expect(formatProblem(20261006, "date")).toBe("not a date");
    expect(formatProblem("yesterday", "datetime")).toBe("not a datetime");
    expect(formatProblem("2026-10-06", "datetime")).toBe("not a datetime");
    expect(formatProblem("2026-10-06", "date")).toBe(null);
    expect(formatProblem("anything", "markdown")).toBe(null);
    expect(formatProblem("anything", undefined)).toBe(null);
  });
});

describe("boundProblem", () => {
  test("numbers, bounds included", () => {
    expect(boundProblem(5, undefined, 1, 5)).toBe(null);
    expect(boundProblem(1, undefined, 1, 5)).toBe(null);
    expect(boundProblem(7, undefined, 1, 5)).toBe("above max 5");
    expect(boundProblem(0.5, undefined, 1, undefined)).toBe("below min 1");
    expect(boundProblem(7n, undefined, undefined, 5)).toBe("above max 5");
  });
  test("a value of the wrong kind is not compared", () => {
    expect(boundProblem("7", undefined, undefined, 5)).toBe(null);
    expect(boundProblem("2026-02-31", "date", "2027-01-01", undefined)).toBe(null);
    expect(boundProblem("2026-10-06T09:00", "date", "2027-01-01", undefined)).toBe(null);
  });
  test("dates and datetimes compare as points in time", () => {
    expect(boundProblem("2025-12-31", "date", "2026-01-01", undefined)).toBe("below min 2026-01-01");
    expect(boundProblem("2026-01-01T08:00:00+09:00", "datetime", "2026-01-01", undefined)).toBe("below min 2026-01-01");
    expect(boundProblem("2026-01-01T09:00:00+09:00", "datetime", "2026-01-01", undefined)).toBe(null);
    expect(boundProblem("2026-12-31T23:00:00-05:00", "datetime", undefined, "2026-12-31T23:59:59Z")).toBe(
      "above max 2026-12-31T23:59:59Z",
    );
  });
});
