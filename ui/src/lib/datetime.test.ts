import { expect, test } from "vitest";
import { fromPicker, localOffset, pickerBound, toPicker } from "./datetime";

const tokyo = () => "+09:00";

test("toPicker shows what a datetime-local input can, with a step that keeps the seconds", () => {
  expect(toPicker("2026-10-06T09:05+09:00")).toEqual({ value: "2026-10-06T09:05", step: 60 });
  expect(toPicker("2026-10-06 09:05:30Z")).toEqual({ value: "2026-10-06T09:05:30", step: 1 });
  expect(toPicker("2026-10-06T09:05:30.25")).toEqual({ value: "2026-10-06T09:05:30.25", step: 0.001 });
  expect(toPicker("2026-10-06T09:05:30.1234")).toBe(null);
  expect(toPicker("2026-10-06")).toBe(null);
  expect(toPicker("soon")).toBe(null);
});

test("fromPicker keeps the offset, separator and seconds of the value it replaces", () => {
  expect(fromPicker("2026-10-06T12:30", "2026-10-06T09:00:00+09:00", tokyo)).toBe("2026-10-06T12:30:00+09:00");
  expect(fromPicker("2026-10-06T12:30", "2026-10-06 09:00", tokyo)).toBe("2026-10-06 12:30");
  expect(fromPicker("2026-10-06T12:30:15", "2026-10-06T09:00:00Z", tokyo)).toBe("2026-10-06T12:30:15Z");
  expect(fromPicker("2026-10-06T12:30:15.5", "2026-10-06T09:00:00.000-05:00", tokyo)).toBe(
    "2026-10-06T12:30:15.500-05:00",
  );
});

test("a new value gets the browser's offset and no seconds", () => {
  expect(fromPicker("2026-10-06T12:30", null, tokyo)).toBe("2026-10-06T12:30+09:00");
  expect(fromPicker("not a picker value", null, tokyo)).toBe(null);
});

test("localOffset formats the browser's offset at that moment", () => {
  expect(localOffset("2026-10-06", "12", "00")).toMatch(/^[+-]\d{2}:\d{2}$/);
});

test("pickerBound shows a bound's instant in the offset the picker is read in", () => {
  expect(pickerBound("2026-01-01", "+09:00")).toBe("2026-01-01T09:00");
  expect(pickerBound("2026-12-31T23:59:59+09:00", "Z")).toBe("2026-12-31T14:59:59");
  expect(pickerBound("2026-01-01", null)).toBe("2026-01-01T00:00");
  expect(pickerBound(5, "Z")).toBe(undefined);
  expect(pickerBound(undefined, "Z")).toBe(undefined);
  expect(pickerBound("soon", "Z")).toBe(undefined);
});

test("fromPicker keeps the digits a longer picked fraction adds, up to three", () => {
  expect(fromPicker("2026-10-06T12:30:15.256", "2026-10-06T09:00:00.5Z", tokyo)).toBe("2026-10-06T12:30:15.256Z");
  expect(fromPicker("2026-10-06T12:30:15.5", "2026-10-06T09:00:00.500Z", tokyo)).toBe("2026-10-06T12:30:15.500Z");
});
