import { execFileSync, spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { beforeAll, expect, test } from "vitest";
import { sql, dataRoot, tmpRoot, write } from "./helpers.ts";

const repo = resolve(import.meta.dirname, "..");
const bin = join(repo, "dist", "cli.mjs");
const run = (...args: string[]) => spawnSync(process.execPath, [bin, ...args], { encoding: "utf8" });

beforeAll(() => {
  execFileSync("pnpm", ["build"], { cwd: repo, stdio: "ignore" });
}, 120_000);

test("status then sync", () => {
  const root = dataRoot();
  write(join(root, "tasks/a.yaml"), "title: A\n");
  const status = run("status", root);
  expect(status.status).toBe(0);
  expect(status.stdout).toContain("● tasks   1 → db");
  expect(status.stdout).toContain("1 change · 1 new column pending");
  expect(status.stdout).not.toContain("\u001b[");
  const synced = run("sync", root, "--json");
  expect(synced.status).toBe(0);
  expect(JSON.parse(synced.stdout)[0]).toMatchObject({ table: "tasks", ok: true, toDb: 1 });
  expect(sql(join(root, ".yamlite", "db.sqlite"), "SELECT id, title FROM tasks")).toEqual([{ id: "a", title: "A" }]);
});

test("sync exits 1 when a table fails", () => {
  const root = dataRoot();
  write(join(root, "people.yaml"), "- [\n");
  const r = run("sync", root);
  expect(r.status).toBe(1);
  expect(r.stdout).toMatch(/✗ people {3}.*people\.yaml/);
  expect(r.stdout).toContain("1 error");
});

test("prints the version", () => {
  const { version } = JSON.parse(readFileSync(join(repo, "package.json"), "utf8")) as { version: string };
  expect(run("--version").stdout.trim()).toBe(version);
});

test("init creates yamlite.yaml and refuses to overwrite it", () => {
  const root = tmpRoot();
  write(join(root, "tasks/a.yaml"), "title: A\n");
  expect(run("sync", root).status).toBe(1);
  const printed = run("init", root, "--print");
  expect(printed.stdout).toContain("  tasks:\n    columns:\n      title: TEXT\n");
  const created = run("init", root);
  expect(created.status).toBe(0);
  expect(created.stdout).toContain("wrote");
  expect(run("init", root).stderr).toContain("already exists");
  expect(run("sync", root).status).toBe(0);
});
