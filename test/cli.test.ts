import { execFileSync, spawn, spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { beforeAll, expect, test } from "vitest";
import { sql, dataRoot, tmpRoot, write } from "./helpers.ts";

const repo = resolve(import.meta.dirname, "..");
const bin = join(repo, "dist", "cli.mjs");
const run = (...args: string[]) => spawnSync(process.execPath, [bin, ...args], { encoding: "utf8" });

beforeAll(() => {
  execFileSync("pnpm", ["build"], { cwd: repo, stdio: "ignore" });
}, 120_000);

// the built cli writes a WAL database, which the node VFS under sqlite-wasm cannot open
test.skipIf(process.env.YAMLITE_SQLITE === "wasm")("status then sync", () => {
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

test("export writes a static site and lists what it wrote", () => {
  const root = dataRoot();
  write(join(root, "tasks/a.yaml"), "title: A\n");
  const out = join(tmpRoot(), "site");
  const r = run("export", root, "--out", out);
  expect(r.status).toBe(0);
  expect(r.stdout).toContain("✓ exported 1 table");
  expect(r.stdout).toContain(out);
  expect(readFileSync(join(out, "index.html"), "utf8")).toContain('content="static"');
  expect(JSON.parse(readFileSync(join(out, "data/yaml/tasks.json"), "utf8"))).toEqual({
    files: { "tasks/a.yaml": "title: A\n" },
    keys: { a: "tasks/a.yaml" },
  });
});

test("check exits 0 without problems and 1 with them, and writes nothing", () => {
  const root = tmpRoot();
  write(
    join(root, "yamlite.yaml"),
    "tables:\n  tasks:\n    columns: { status: TEXT }\n    values: { status: [todo] }\n",
  );
  write(join(root, "tasks/a.yaml"), "status: todo\n");
  const ok = run("check", root);
  expect(ok.status).toBe(0);
  expect(ok.stdout).toContain("✓ no problems");
  write(join(root, "tasks/a.yaml"), "status: doen\n");
  const bad = run("check", root, "--json");
  expect(bad.status).toBe(1);
  expect(JSON.parse(bad.stdout)).toMatchObject({
    ok: false,
    tables: [{ table: "tasks", warnings: ['status "doen" not in values (a)'] }],
  });
  expect(existsSync(join(root, ".yamlite"))).toBe(false);
});

test("check does not take --db", () => {
  const r = run("check", tmpRoot(), "--db", "x.db");
  expect(r.status).not.toBe(0);
  expect(r.stderr).toContain("unknown option '--db'");
});

test("query prints a table, JSON or CSV, and reports rows and truncation on stderr", () => {
  const root = tmpRoot();
  write(join(root, "yamlite.yaml"), "tables:\n  tasks:\n    columns: { title: TEXT }\n");
  write(join(root, "tasks/a.yaml"), "title: A\n");
  write(join(root, "tasks/b.yaml"), "title: B\n");
  const table = run("query", "select id, title from tasks order by id", root);
  expect(table.status).toBe(0);
  expect(table.stdout).toBe("id  title\n--  -----\na   A\nb   B\n");
  expect(table.stderr).toContain("2 rows");
  const json = run("query", "select id from tasks order by id", root, "--format", "json");
  expect(JSON.parse(json.stdout)).toEqual([{ id: "a" }, { id: "b" }]);
  const csv = run("query", "select id from tasks order by id", root, "--format", "csv", "--limit", "1");
  expect(csv.stdout).toBe("id\na\n");
  expect(csv.stderr).toContain("… truncated at 1 rows (use --limit)");
  expect(existsSync(join(root, ".yamlite"))).toBe(false);
});

test("query exits 1 with a specific message on a write, an SQL error or a bad option", () => {
  const root = tmpRoot();
  write(join(root, "yamlite.yaml"), "tables: {}\n");
  const cases: [string[], string][] = [
    [["delete from x", root], "query only reads"],
    [["select nope", root], "no such column"],
    [["select 1", root, "--format", "xml"], "unknown format xml"],
    [["select 1", root, "--format", "constructor"], "unknown format constructor"],
    [["select 1", root, "--limit", "abc"], "--limit must be a whole number"],
  ];
  for (const [args, message] of cases) {
    const r = run("query", ...args);
    expect(r.status).toBe(1);
    expect(r.stdout).toBe("");
    expect(r.stderr).toContain(message);
  }
});

test("query --limit 0 does not truncate, and one row is singular", () => {
  const root = tmpRoot();
  write(join(root, "yamlite.yaml"), "tables:\n  tasks:\n    columns: { title: TEXT }\n");
  write(join(root, "tasks/a.yaml"), "title: A\n");
  write(join(root, "tasks/b.yaml"), "title: B\n");
  const all = run("query", "select id from tasks", root, "--limit", "0");
  expect(all.stdout).toBe("id\n--\na\nb\n");
  expect(all.stderr).toContain("2 rows");
  expect(all.stderr).not.toContain("truncated");
  const one = run("query", "select id from tasks where id = 'a'", root);
  expect(one.stderr).toContain("1 row");
  expect(one.stderr).not.toContain("1 rows");
});

test("guide prints the guide to writing yamlite.yaml", () => {
  const r = run("guide");
  expect(r.status).toBe(0);
  expect(r.stdout).toBe(readFileSync(join(repo, "src", "guide.md"), "utf8"));
});

test("guide piped into a reader that stops early prints no error", () => {
  const r = spawnSync("sh", ["-c", `"${process.execPath}" "${bin}" guide | head -1`], { encoding: "utf8" });
  expect(r.stdout).toBe("# Writing yamlite.yaml\n");
  expect(r.stderr).toBe("");
});

test("every command the guide names exists", () => {
  const help = run("--help").stdout;
  const named = new Set([...run("guide").stdout.matchAll(/`yamlite (\w+)/g)].map((m) => m[1]!));
  expect(named.size).toBeGreaterThan(0);
  for (const cmd of named) expect(help, cmd).toMatch(new RegExp(`^\\s+${cmd}\\b`, "m"));
});
