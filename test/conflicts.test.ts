import { readdirSync } from "node:fs";
import { join } from "node:path";
import { expect, test } from "vitest";
import { DELETED_MARKER, readConflictHeader, saveConflict } from "../src/conflicts.ts";
import { read, tmpRoot } from "./helpers.ts";

const header = (key: string, winner: string) =>
  `# yamlite: {"table":"t","key":${JSON.stringify(key)},"winner":"${winner}","at":"1970-01-01T00:00:00.000Z"}\n`;

test("backups never overwrite each other", () => {
  const dir = tmpRoot();
  const now = new Date(0);
  const p1 = saveConflict(dir, "t", "a b", { x: 1 }, "file", now);
  const p2 = saveConflict(dir, "t", "a:b", { x: 2 }, "db", now);
  expect(p1).not.toBe(p2);
  expect(read(p1)).toBe(`${header("a b", "file")}x: 1\n`);
  expect(read(p2)).toBe(`${header("a:b", "db")}x: 2\n`);
  expect(readdirSync(join(dir, "conflicts", "t"))).toHaveLength(2);
});

test("the header keeps the original key, which the file name cannot", () => {
  const dir = tmpRoot();
  const p = saveConflict(dir, "t", "automation/CAP-001", { x: 1 }, "file", new Date(0));
  expect(p).toContain("automation_CAP-001");
  expect(readConflictHeader(read(p))).toEqual({
    table: "t",
    key: "automation/CAP-001",
    winner: "file",
    at: "1970-01-01T00:00:00.000Z",
  });
});

test("a deleted side is written after the header", () => {
  const dir = tmpRoot();
  const p = saveConflict(dir, "t", "a", null, "db", new Date(0));
  expect(read(p)).toBe(`${header("a", "db")}${DELETED_MARKER}\n`);
});

test("files without a header have no header", () => {
  expect(readConflictHeader("x: 1\n")).toBeNull();
  expect(readConflictHeader("# yamlite: not json\n")).toBeNull();
  expect(readConflictHeader('# yamlite: {"table":"t"}\n')).toBeNull();
});
