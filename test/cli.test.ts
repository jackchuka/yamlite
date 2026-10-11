import { execFile, execFileSync, spawn } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { beforeAll, expect, test } from "vitest";
import { sql, dataRoot, tmpRoot, write } from "./helpers.ts";

const repo = resolve(import.meta.dirname, "..");
const bin = join(repo, "dist", "cli.mjs");
type Ran = { status: number | null; stdout: string; stderr: string };
const exec = (file: string, args: string[]) =>
  new Promise<Ran>((resolve) =>
    execFile(file, args, (err, stdout, stderr) =>
      resolve({ status: err ? (typeof err.code === "number" ? err.code : null) : 0, stdout, stderr }),
    ),
  );
// each CLI test spawns its own processes in its own folder, so they run concurrently
const run = (...args: string[]) => exec(process.execPath, [bin, ...args]);

beforeAll(() => {
  execFileSync("pnpm", ["build"], { cwd: repo, stdio: "ignore" });
}, 120_000);

// the built cli writes a WAL database, which the node VFS under sqlite-wasm cannot open
test.skipIf(process.env.YAMLITE_SQLITE === "wasm").concurrent("status then sync", async () => {
  const root = dataRoot();
  write(join(root, "tasks/a.yaml"), "title: A\n");
  const status = await run("status", root);
  expect(status.status).toBe(0);
  expect(status.stdout).toContain("● tasks   1 → db");
  expect(status.stdout).toContain("1 change · 1 new column pending");
  expect(status.stdout).not.toContain("\u001b[");
  const synced = await run("sync", root, "--json");
  expect(synced.status).toBe(0);
  expect(JSON.parse(synced.stdout)[0]).toMatchObject({ table: "tasks", ok: true, toDb: 1 });
  expect(sql(join(root, ".yamlite", "db.sqlite"), "SELECT id, title FROM tasks")).toEqual([{ id: "a", title: "A" }]);
});

test.concurrent("sync exits 1 when a table fails", async () => {
  const root = dataRoot();
  write(join(root, "people.yaml"), "- [\n");
  const r = await run("sync", root);
  expect(r.status).toBe(1);
  expect(r.stdout).toMatch(/✗ people {3}.*people\.yaml/);
  expect(r.stdout).toContain("1 error");
});

test.concurrent("prints the version", async () => {
  const { version } = JSON.parse(readFileSync(join(repo, "package.json"), "utf8")) as { version: string };
  expect((await run("--version")).stdout.trim()).toBe(version);
});

test.concurrent("init creates yamlite.yaml and refuses to overwrite it", async () => {
  const root = tmpRoot();
  write(join(root, "tasks/a.yaml"), "title: A\n");
  expect((await run("sync", root)).status).toBe(1);
  const printed = await run("init", root, "--print");
  expect(printed.stdout).toContain("  tasks:\n    columns:\n      title: TEXT\n");
  const created = await run("init", root);
  expect(created.status).toBe(0);
  expect(created.stdout).toContain("wrote");
  expect((await run("init", root)).stderr).toContain("already exists");
  expect((await run("sync", root)).status).toBe(0);
});

test.concurrent("serve prints a URL that answers, and stops on SIGINT", async () => {
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

test.concurrent("serve rejects a bad port", async () => {
  const r = await run("serve", dataRoot(), "--port", "nope");
  expect(r.status).toBe(1);
  expect(r.stderr).toContain("invalid port: nope");
});

test.concurrent("export writes a static site and lists what it wrote", async () => {
  const root = dataRoot();
  write(join(root, "tasks/a.yaml"), "title: A\n");
  const out = join(tmpRoot(), "site");
  const r = await run("export", root, "--out", out);
  expect(r.status).toBe(0);
  expect(r.stdout).toContain("✓ exported 1 table");
  expect(r.stdout).toContain(out);
  expect(readFileSync(join(out, "index.html"), "utf8")).toContain('content="static"');
  expect(JSON.parse(readFileSync(join(out, "data/yaml/tasks.json"), "utf8"))).toEqual({
    files: { "tasks/a.yaml": "title: A\n" },
    keys: { a: "tasks/a.yaml" },
  });
});

test.concurrent("check exits 0 without problems and 1 with them, and writes nothing", async () => {
  const root = tmpRoot();
  write(
    join(root, "yamlite.yaml"),
    "tables:\n  tasks:\n    columns: { status: TEXT }\n    values: { status: [todo] }\n",
  );
  write(join(root, "tasks/a.yaml"), "status: todo\n");
  const ok = await run("check", root);
  expect(ok.status).toBe(0);
  expect(ok.stdout).toContain("✓ no problems");
  write(join(root, "tasks/a.yaml"), "status: doen\n");
  const bad = await run("check", root, "--json");
  expect(bad.status).toBe(1);
  expect(JSON.parse(bad.stdout)).toMatchObject({
    ok: false,
    tables: [{ table: "tasks", warnings: ['status "doen" not in values (a)'] }],
  });
  expect(existsSync(join(root, ".yamlite"))).toBe(false);
});

test.concurrent("check does not take --db", async () => {
  const r = await run("check", tmpRoot(), "--db", "x.db");
  expect(r.status).not.toBe(0);
  expect(r.stderr).toContain("unknown option '--db'");
});

test.concurrent("query prints a table, JSON or CSV, and reports rows and truncation on stderr", async () => {
  const root = tmpRoot();
  write(join(root, "yamlite.yaml"), "tables:\n  tasks:\n    columns: { title: TEXT }\n");
  write(join(root, "tasks/a.yaml"), "title: A\n");
  write(join(root, "tasks/b.yaml"), "title: B\n");
  const table = await run("query", "select id, title from tasks order by id", root);
  expect(table.status).toBe(0);
  expect(table.stdout).toBe("id  title\n--  -----\na   A\nb   B\n");
  expect(table.stderr).toContain("2 rows");
  const json = await run("query", "select id from tasks order by id", root, "--format", "json");
  expect(JSON.parse(json.stdout)).toEqual([{ id: "a" }, { id: "b" }]);
  const csv = await run("query", "select id from tasks order by id", root, "--format", "csv", "--limit", "1");
  expect(csv.stdout).toBe("id\na\n");
  expect(csv.stderr).toContain("… truncated at 1 rows (use --limit)");
  expect(existsSync(join(root, ".yamlite"))).toBe(false);
});

test.concurrent("query exits 1 with a specific message on a write, an SQL error or a bad option", async () => {
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
    const r = await run("query", ...args);
    expect(r.status).toBe(1);
    expect(r.stdout).toBe("");
    expect(r.stderr).toContain(message);
  }
});

test.concurrent("query --limit 0 does not truncate, and one row is singular", async () => {
  const root = tmpRoot();
  write(join(root, "yamlite.yaml"), "tables:\n  tasks:\n    columns: { title: TEXT }\n");
  write(join(root, "tasks/a.yaml"), "title: A\n");
  write(join(root, "tasks/b.yaml"), "title: B\n");
  const all = await run("query", "select id from tasks", root, "--limit", "0");
  expect(all.stdout).toBe("id\n--\na\nb\n");
  expect(all.stderr).toContain("2 rows");
  expect(all.stderr).not.toContain("truncated");
  const one = await run("query", "select id from tasks where id = 'a'", root);
  expect(one.stderr).toContain("1 row");
  expect(one.stderr).not.toContain("1 rows");
});

test.concurrent("guide prints the guide to writing yamlite.yaml", async () => {
  const r = await run("guide");
  expect(r.status).toBe(0);
  expect(r.stdout).toBe(readFileSync(join(repo, "src", "guide.md"), "utf8"));
});

test.concurrent("guide piped into a reader that stops early prints no error", async () => {
  const r = await exec("sh", ["-c", `"${process.execPath}" "${bin}" guide | head -1`]);
  expect(r.stdout).toBe("# Writing yamlite.yaml\n");
  expect(r.stderr).toBe("");
});

test.concurrent("every command the guide names exists", async () => {
  const help = (await run("--help")).stdout;
  const named = new Set([...(await run("guide")).stdout.matchAll(/`yamlite (\w+)/g)].map((m) => m[1]!));
  expect(named.size).toBeGreaterThan(0);
  for (const cmd of named) expect(help, cmd).toMatch(new RegExp(`^\\s+${cmd}\\b`, "m"));
});

async function hostWarning(args: string[], env: Record<string, string | undefined>): Promise<string> {
  const child = spawn(process.execPath, [bin, "serve", dataRoot(), "--port", "0", "--host", "0.0.0.0", ...args], {
    stdio: ["ignore", "pipe", "pipe"],
    env: { ...process.env, ANTHROPIC_API_KEY: "", OPENAI_API_KEY: "", ...env },
  });
  let err = "";
  child.stderr.setEncoding("utf8");
  child.stderr.on("data", (c: string) => (err += c));
  await new Promise<void>((resolve, reject) => {
    child.stdout.on("data", () => resolve());
    child.once("exit", (code) => reject(new Error(`serve exited with ${code}: ${err}`)));
  });
  child.kill("SIGINT");
  await new Promise((resolve) => child.once("exit", resolve));
  return err;
}

test.concurrent("serve --host warns that environment API keys reach Ask AI users", async () => {
  expect(await hostWarning([], { ANTHROPIC_API_KEY: "dummy" })).toContain(
    "use Ask AI with the API keys from the environment",
  );
  expect(await hostWarning(["--no-agent"], { ANTHROPIC_API_KEY: "dummy" })).not.toContain("Ask AI");
  expect(await hostWarning([], {})).not.toContain("Ask AI");
}, 60_000);
