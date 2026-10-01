import { readdirSync } from "node:fs";
import { join } from "node:path";
import { expect, test } from "vitest";
import { saveConflict } from "../src/conflicts.ts";
import { read, tmpRoot } from "./helpers.ts";

test("backups never overwrite each other", () => {
  const dir = tmpRoot();
  const now = new Date(0);
  const p1 = saveConflict(dir, "t", "a b", { x: 1 }, now);
  const p2 = saveConflict(dir, "t", "a:b", { x: 2 }, now);
  expect(p1).not.toBe(p2);
  expect(read(p1)).toBe("x: 1\n");
  expect(read(p2)).toBe("x: 2\n");
  expect(readdirSync(join(dir, "conflicts", "t"))).toHaveLength(2);
});
