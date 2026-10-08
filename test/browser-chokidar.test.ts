import { afterEach, expect, test } from "vitest";
import * as fs from "../src/browser/fs.ts";
import { watch } from "../src/browser/chokidar.ts";

const closers: Array<() => Promise<void>> = [];
afterEach(async () => {
  for (const c of closers.splice(0)) await c();
  fs.rmSync("/w", { recursive: true, force: true });
});

function collect(paths: string[], opts?: { depth?: number }) {
  const events: string[] = [];
  const w = watch(paths, { ignoreInitial: true, ...opts });
  w.on("all", (event: string, path: string) => events.push(`${event} ${path}`));
  closers.push(() => w.close());
  return { events, ready: new Promise<void>((r) => w.once("ready", () => r())) };
}

test("reports writes, removals and folders under a watched folder", async () => {
  fs.mkdirSync("/w/tasks", { recursive: true });
  const { events, ready } = collect(["/w/tasks"]);
  await ready;
  fs.writeFileSync("/w/tasks/a.yaml", "x: 1\n");
  fs.writeFileSync("/w/tasks/a.yaml", "x: 2\n");
  fs.mkdirSync("/w/tasks/sub");
  fs.writeFileSync("/w/tasks/sub/b.yaml", "y: 1\n");
  fs.unlinkSync("/w/tasks/a.yaml");
  fs.rmSync("/w/tasks/sub", { recursive: true });
  expect(events).toEqual([
    "add /w/tasks/a.yaml",
    "change /w/tasks/a.yaml",
    "addDir /w/tasks/sub",
    "add /w/tasks/sub/b.yaml",
    "unlink /w/tasks/a.yaml",
    "unlink /w/tasks/sub/b.yaml",
    "unlinkDir /w/tasks/sub",
  ]);
});

test("depth 0 ignores deeper paths, and nothing is reported after close", async () => {
  fs.mkdirSync("/w/sub", { recursive: true });
  const { events, ready } = collect(["/w"], { depth: 0 });
  await ready;
  fs.writeFileSync("/w/sub/deep.yaml", "");
  fs.writeFileSync("/w/top.yaml", "");
  await closers.pop()?.();
  fs.writeFileSync("/w/after.yaml", "");
  expect(events).toEqual(["add /w/top.yaml"]);
});

test("a rename reports the old paths gone and the new ones added", async () => {
  fs.mkdirSync("/w", { recursive: true });
  fs.writeFileSync("/w/a.yaml", "");
  const { events, ready } = collect(["/w"]);
  await ready;
  fs.renameSync("/w/a.yaml", "/w/b.yaml");
  expect(events).toEqual(["unlink /w/a.yaml", "add /w/b.yaml"]);
});

test("a rename over an existing file reports a change to the target", async () => {
  fs.mkdirSync("/w", { recursive: true });
  fs.writeFileSync("/w/people.yaml", "a: 1\n");
  fs.writeFileSync("/w/.tmp", "a: 2\n");
  const { events, ready } = collect(["/w"]);
  await ready;
  fs.renameSync("/w/.tmp", "/w/people.yaml");
  expect(events).toEqual(["unlink /w/.tmp", "change /w/people.yaml"]);
});

test("a copy over an existing file reports a change", async () => {
  fs.mkdirSync("/w", { recursive: true });
  fs.writeFileSync("/w/a.yaml", "a: 1\n");
  fs.writeFileSync("/w/b.yaml", "b: 1\n");
  const { events, ready } = collect(["/w"]);
  await ready;
  fs.cpSync("/w/a.yaml", "/w/b.yaml");
  fs.cpSync("/w/a.yaml", "/w/c.yaml");
  expect(events).toEqual(["change /w/b.yaml", "add /w/c.yaml"]);
});

test("ignored paths and everything under them are skipped", async () => {
  fs.mkdirSync("/w/.hidden", { recursive: true });
  const events: string[] = [];
  const w = watch(["/w"], { ignored: (p) => p.split("/").pop()?.startsWith(".") ?? false });
  w.on("all", (event: string, path: string) => events.push(`${event} ${path}`));
  closers.push(() => w.close());
  await new Promise<void>((r) => w.once("ready", () => r()));
  fs.writeFileSync("/w/.hidden/x.yaml", "");
  fs.writeFileSync("/w/y.yaml", "");
  expect(events).toEqual(["add /w/y.yaml"]);
});

test("a watched folder that does not exist yet reports its creation", async () => {
  const { events, ready } = collect(["/w/late"]);
  await ready;
  fs.mkdirSync("/w/late", { recursive: true });
  fs.writeFileSync("/w/late/a.yaml", "");
  expect(events).toEqual(["addDir /w/late", "add /w/late/a.yaml"]);
});
