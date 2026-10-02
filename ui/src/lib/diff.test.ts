import { expect, test } from "vitest";
import { diffRows, restoreLabel } from "./diff";

test("fields are compared side by side, the key is left out", () => {
  expect(
    diffRows({ id: "a", priority: 2, tags: ["work", "ci"] }, { priority: 3, tags: ["work"], note: "x" }, "id"),
  ).toEqual([
    { field: "priority", winner: 2, saved: 3, same: false },
    { field: "tags", winner: ["work", "ci"], saved: ["work"], same: false },
    { field: "note", winner: undefined, saved: "x", same: false },
  ]);
  expect(diffRows({ a: 1 }, { a: 1 })).toEqual([{ field: "a", winner: 1, saved: 1, same: true }]);
  expect(diffRows(null, { a: 1 })).toEqual([{ field: "a", winner: undefined, saved: 1, same: false }]);
});

test("the restore button names the side that comes back", () => {
  expect(restoreLabel("file")).toBe("DB 側に戻す");
  expect(restoreLabel("db")).toBe("ファイル側に戻す");
  expect(restoreLabel(null)).toBe("復元できません");
});
