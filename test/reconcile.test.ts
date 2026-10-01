import { describe, expect, test } from "vitest";
import { decide, type KeyState, plan } from "../src/reconcile.ts";

const s = (o: Partial<KeyState>): KeyState => ({
  key: "k",
  f: null,
  d: null,
  base: null,
  skip: false,
  equal: false,
  ...o,
});
const B = { f: "f0", d: "d0" };

describe("decide", () => {
  test.each<[string, Partial<KeyState>, string, string | undefined]>([
    ["new file", { f: "f1" }, "toDb", undefined],
    ["new row", { d: "d1" }, "toFile", undefined],
    ["new on both sides, equal", { f: "f1", d: "d1", equal: true }, "base", undefined],
    ["new on both sides, different, db time unknown", { f: "f1", d: "d1" }, "toFile", "db"],
    ["unchanged", { f: "f0", d: "d0", base: B }, "none", undefined],
    ["file changed", { f: "f1", d: "d0", base: B }, "toDb", undefined],
    ["row changed", { f: "f0", d: "d1", base: B }, "toFile", undefined],
    ["file deleted", { f: null, d: "d0", base: B }, "toDb", undefined],
    ["row deleted", { f: "f0", d: null, base: B }, "toFile", undefined],
    ["both deleted", { f: null, d: null, base: B }, "drop", undefined],
    ["both changed, equal", { f: "f1", d: "d1", base: B, equal: true }, "base", undefined],
    ["both changed, file newer", { f: "f1", d: "d1", base: B, fTime: 200, dTime: 100 }, "toDb", "file"],
    ["both changed, db newer", { f: "f1", d: "d1", base: B, fTime: 100, dTime: 200 }, "toFile", "db"],
    ["file deleted, row changed", { f: null, d: "d1", base: B }, "toFile", "db"],
    ["skipped", { f: "f1", d: "d1", base: B, skip: true }, "none", undefined],
  ])("%s", (_name, input, action, conflict) => {
    expect(decide(s(input))).toEqual(conflict ? { key: "k", action, conflict } : { key: "k", action });
  });
});

describe("plan guard", () => {
  const deletions = (n: number, total: number): KeyState[] =>
    Array.from({ length: total }, (_, i) => s({ key: `k${i}`, f: i < n ? null : "f0", d: "d0", base: B }));

  test("counts deletions per side", () => {
    const p = plan([...deletions(2, 3), s({ key: "x", f: "f0", d: null, base: B })], { force: false });
    expect(p.deleteDb).toBe(2);
    expect(p.deleteFile).toBe(1);
    expect(p.blocked).toBeNull();
  });

  test("blocks more than max(10, 50%) deletions", () => {
    expect(plan(deletions(12, 12), { force: false }).blocked).toMatch(/refusing to delete 12 rows/);
    expect(plan(deletions(10, 12), { force: false }).blocked).toBeNull();
    expect(plan(deletions(51, 100), { force: false }).blocked).not.toBeNull();
    expect(plan(deletions(50, 100), { force: false }).blocked).toBeNull();
  });

  test("force disables the guard", () => {
    expect(plan(deletions(12, 12), { force: true }).blocked).toBeNull();
  });

  test("blocks deleting every synced record of a table", () => {
    expect(plan(deletions(3, 3), { force: false }).blocked).toMatch(/refusing/);
    const rowsGone = Array.from({ length: 3 }, (_, i) => s({ key: `k${i}`, f: "f0", d: null, base: B }));
    expect(plan(rowsGone, { force: false }).blocked).toMatch(/refusing/);
    expect(plan(deletions(3, 3), { force: true }).blocked).toBeNull();
    expect(plan(deletions(1, 3), { force: false }).blocked).toBeNull();
  });
});
