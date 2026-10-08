import { DatabaseSync } from "node:sqlite";
import { expect, test } from "vitest";

test("node:sqlite is the wasm build here", () => {
  const db = new DatabaseSync(":memory:");
  const v = db.prepare("select sqlite_version() v").get() as { v: string };
  expect(DatabaseSync.name).toBe("DatabaseSync");
  expect(String(db.constructor).includes("oo1")).toBe(true);
  expect(v.v).toMatch(/^3\./);
});
