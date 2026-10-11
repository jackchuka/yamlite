import { chmodSync } from "node:fs";
import { join } from "node:path";
import { expect, test } from "vitest";
import { which } from "../src/which.ts";
import { tmpRoot, write } from "./helpers.ts";

test("which finds executables on PATH only", () => {
  const dir = tmpRoot();
  write(join(dir, "tool"), "#!/bin/sh\n");
  chmodSync(join(dir, "tool"), 0o755);
  write(join(dir, "plain"), "not executable");
  expect(which("tool", { PATH: dir })).toBe(join(dir, "tool"));
  expect(which("plain", { PATH: dir })).toBeNull();
});
