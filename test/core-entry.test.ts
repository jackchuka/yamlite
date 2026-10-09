import { existsSync } from "node:fs";
import { expect, test } from "vitest";
import { browserAliases } from "../src/browser/aliases.ts";

test("the core entry exposes what an embedding app needs", async () => {
  const core = await import("../src/core.ts");
  for (const name of ["open", "init", "check", "query", "createWorkspace", "ReviewRefused", "HttpError"])
    expect(core, name).toHaveProperty(name);
});

test("every replacement path browserAliases returns exists on disk", () => {
  for (const { find, replacement } of browserAliases())
    expect(existsSync(replacement), `${find}: ${replacement}`).toBe(true);
});

test("core exports the helpers a host's GitDriver builds history entries with", async () => {
  const core = await import("../src/core.ts");
  const d = core.describeChange({ a: 1, b: "x" }, { a: 2, b: "x" });
  expect(d).toEqual({ changes: [{ path: "a", from: 1, to: 2 }], record: { a: 2, b: "x" } });
  expect(core.worthShowing(d!)).toBe(true);
  expect(core.describeChange(null, null)).toBeNull();
  expect(core.describeChange(null, { a: 1 })).toMatchObject({ event: "created" });
});
