import { execFileSync, spawn, spawnSync } from "node:child_process";
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

test("serve prints a URL that answers, and stops on SIGINT", async () => {
  const root = dataRoot();
  write(join(root, "tasks/a.yaml"), "title: A\n");
  const child = spawn(process.execPath, [bin, "serve", root, "--port", "0"], { stdio: ["ignore", "pipe", "pipe"] });
  const url = await new Promise<string>((resolve, reject) => {
    let out = "";
    child.stdout.setEncoding("utf8");
    child.stdout.on("data", (chunk: string) => {
      out += chunk;
      const m = /(http:\/\/127\.0\.0\.1:\d+\/\?token=[0-9a-f]+)/.exec(out);
      if (m?.[1]) resolve(m[1]);
    });
    child.once("exit", (code) => reject(new Error(`serve exited with ${code}: ${out}`)));
  });
  const token = new URL(url).searchParams.get("token");
  const res = await fetch(new URL("/api/meta", url), { headers: { authorization: `Bearer ${token}` } });
  expect(res.status).toBe(200);
  expect((await res.json()).tables.map((x: { name: string }) => x.name)).toEqual(["tasks"]);
  const page = await fetch(new URL("/", url), { headers: { authorization: `Bearer ${token}` } });
  expect(page.status).toBe(200);
  expect(await page.text()).toContain('<div id="root">');
  child.kill("SIGINT");
  const code = await new Promise((resolve) => child.once("exit", resolve));
  expect(code).toBe(0);
}, 30_000);

test("serve rejects a bad port", () => {
  const r = run("serve", dataRoot(), "--port", "nope");
  expect(r.status).toBe(1);
  expect(r.stderr).toContain("invalid port: nope");
});
