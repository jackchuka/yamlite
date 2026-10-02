import { expect, test } from "vitest";
import { fromWire, toWire, wireValue } from "../../src/serve/wire.ts";

test("rows go out with booleans, parsed JSON and exact big integers", () => {
  const types = new Map([
    ["done", "BOOLEAN"],
    ["tags", "JSON"],
    ["n", "INTEGER"],
    ["big", "INTEGER"],
  ] as const);
  expect(
    toWire({ done: 1n, tags: '["a",{"b":1}]', n: 5n, big: 9007199254740993n, gone: null }, new Map(types)),
  ).toEqual({ done: true, tags: ["a", { b: 1 }], n: 5, big: "9007199254740993", gone: null });
});

test("nested big integers become strings", () => {
  expect(wireValue({ a: [1n, 2n ** 60n] })).toEqual({ a: [1, "1152921504606846976"] });
});

test("values come back as the types the engine expects", () => {
  expect(fromWire("9007199254740993", "INTEGER")).toBe(9007199254740993n);
  expect(fromWire(3, "INTEGER")).toBe(3n);
  expect(fromWire(3, undefined)).toBe(3n);
  expect(fromWire(3, "REAL")).toBe(3);
  expect(fromWire("12", "TEXT")).toBe("12");
  expect(fromWire(true, "BOOLEAN")).toBe(true);
  expect(fromWire({ a: 1 }, "JSON")).toEqual({ a: 1 });
  expect(fromWire(undefined, "TEXT")).toBeNull();
});
