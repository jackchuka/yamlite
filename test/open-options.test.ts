import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { expect, test } from "vitest";
import { open } from "../src/index.ts";
import { acquireLock } from "../src/lock.ts";
import { dataRoot, tmpRoot, write } from "./helpers.ts";

test("persistConfig: false syncs new tables and columns without writing yamlite.yaml", async () => {
  const root = dataRoot();
  write(join(root, "tasks/a.yaml"), "title: A\n");
  const before = readFileSync(join(root, "yamlite.yaml"), "utf8");
  const tmp = tmpRoot();
  const y = await open({ root, db: join(tmp, "db.sqlite"), stateDir: join(tmp, "state"), persistConfig: false });
  try {
    const [r] = await y.sync();
    expect(r).toMatchObject({ table: "tasks", ok: true, toDb: 1 });
    expect(y.tables.find((t) => t.name === "tasks")?.columns).toMatchObject({ title: "TEXT" });
  } finally {
    await y.close();
  }
  expect(readFileSync(join(root, "yamlite.yaml"), "utf8")).toBe(before);
  expect(existsSync(join(root, ".yamlite"))).toBe(false);
});

test("stateDir moves the lock out of the root", async () => {
  const root = dataRoot();
  write(join(root, "tasks/a.yaml"), "title: A\n");
  const release = acquireLock(join(root, ".yamlite"));
  const tmp = tmpRoot();
  try {
    const y = await open({ root, db: join(tmp, "db.sqlite"), stateDir: join(tmp, "state"), persistConfig: false });
    await y.sync();
    await y.close();
  } finally {
    release();
  }
});
