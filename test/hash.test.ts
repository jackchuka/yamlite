import { describe, expect, test } from "vitest";
import { canonical, hashContent, hashRecord } from "../src/hash.ts";

describe("canonical", () => {
  test("sorts keys recursively", () => {
    expect(canonical({ b: { d: 1, c: 2 }, a: [{ y: 1, x: 2 }] })).toBe('{"a":[{"x":2,"y":1}],"b":{"c":2,"d":1}}');
  });

  test("drops null and undefined object fields but keeps nulls in arrays", () => {
    expect(canonical({ a: 1, b: null, c: undefined })).toBe('{"a":1}');
    expect(canonical([1, null])).toBe("[1,null]");
  });

  test("safe bigints equal numbers, unsafe bigints are marked", () => {
    expect(canonical({ a: 1n })).toBe(canonical({ a: 1 }));
    expect(canonical(2n ** 60n)).toBe('{"$big":"1152921504606846976"}');
  });

  test("bytes are base64 encoded", () => {
    expect(canonical(new Uint8Array([1, 2]))).toBe('{"$bytes":"AQI="}');
  });
});

describe("hashRecord / hashContent", () => {
  test("record hash ignores key order and null fields", () => {
    expect(hashRecord({ a: 1, b: "x" })).toBe(hashRecord({ b: "x", a: 1, c: null }));
    expect(hashRecord({ a: 1 })).not.toBe(hashRecord({ a: 2 }));
    expect(hashRecord({ a: 1 })).toMatch(/^[0-9a-f]{64}$/);
  });

  test("content hash is the same for string and bytes", () => {
    expect(hashContent("あ")).toBe(hashContent(Buffer.from("あ")));
  });
});
