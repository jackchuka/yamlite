import { join } from "node:path";
import { afterEach, expect, test } from "vitest";
import { write } from "../helpers.ts";
import { events, type Served, startServe, waitForAsync } from "./helpers.ts";

let t: Served | undefined;
afterEach(async () => {
  await t?.s.close();
  t = undefined;
});

const CONFIG =
  "tables: {}\npages:\n  board:\n    path: .pages/board.html\n    title: Board\n" +
  "    access: { tasks: write }\n    sql: true\n    network: [https://cdn.example.com]\n";
const FILES = { "tasks/a.yaml": "title: A\n", ".pages/board.html": "<p>hi</p>" };

test("meta lists pages with their permissions and a root-relative path", async () => {
  t = await startServe(FILES, CONFIG);
  expect((await t.api("/api/meta")).body.pages).toEqual([
    {
      name: "board",
      title: "Board",
      path: ".pages/board.html",
      access: { tasks: "write" },
      sql: true,
      network: ["https://cdn.example.com"],
    },
  ]);
});

test("the html route returns the page's file", async () => {
  t = await startServe(FILES, CONFIG);
  expect(await t.api("/api/pages/board/html")).toEqual({ status: 200, body: { html: "<p>hi</p>" } });
});

test("an unknown page and a missing file are 404", async () => {
  t = await startServe({ "tasks/a.yaml": "title: A\n" }, CONFIG);
  expect(await t.api("/api/pages/nope/html")).toEqual({ status: 404, body: { error: "unknown page: nope" } });
  expect(await t.api("/api/pages/board/html")).toEqual({
    status: 404,
    body: { error: "page file not found: .pages/board.html" },
  });
});

test("a page file over 1 MB is refused", async () => {
  t = await startServe({ ...FILES, ".pages/board.html": "x".repeat(1_048_577) }, CONFIG);
  expect(await t.api("/api/pages/board/html")).toEqual({
    status: 413,
    body: { error: ".pages/board.html is larger than 1 MB" },
  });
});

test("saving a page's file streams a page event that stays out of the activity", async () => {
  t = await startServe(FILES, CONFIG);
  const ev = await events(t);
  try {
    write(join(t.root, ".pages/board.html"), "<p>new</p>");
    await waitForAsync(async () => ev.got.some((e) => e.type === "page" && e.pages.includes("board")));
  } finally {
    await ev.close();
  }
  const again = await events(t);
  try {
    await waitForAsync(async () => again.got.some((e) => e.type === "hello"));
    const hello = again.got.find((e) => e.type === "hello");
    expect(hello?.activity.some((e: { type: string }) => e.type === "page")).toBe(false);
  } finally {
    await again.close();
  }
});

test("two pages on one file both hear about a save", async () => {
  const config = `${CONFIG}  copy:\n    path: .pages/board.html\n`;
  t = await startServe(FILES, config);
  const ev = await events(t);
  try {
    write(join(t.root, ".pages/board.html"), "<p>shared</p>");
    await waitForAsync(async () => {
      const named = ev.got.filter((e) => e.type === "page").flatMap((e) => e.pages as string[]);
      return named.includes("board") && named.includes("copy");
    });
  } finally {
    await ev.close();
  }
});

test("a page added to yamlite.yaml is watched after the reload", async () => {
  t = await startServe({ "tasks/a.yaml": "title: A\n" }, "tables: {}\n");
  const served = t;
  write(join(served.root, ".pages/later.html"), "<p>1</p>");
  write(join(served.root, "yamlite.yaml"), "tables: {}\npages:\n  later:\n    path: .pages/later.html\n");
  await waitForAsync(async () => (await served.api("/api/meta")).body.pages.length === 1);
  const ev = await events(served);
  try {
    write(join(served.root, ".pages/later.html"), "<p>2</p>");
    await waitForAsync(async () => ev.got.some((e) => e.type === "page" && e.pages.includes("later")));
  } finally {
    await ev.close();
  }
});

test("a page whose folder does not exist yet is watched once it appears", async () => {
  t = await startServe({ "tasks/a.yaml": "title: A\n" }, "tables: {}\npages:\n  late:\n    path: later/p.html\n");
  const served = t;
  write(join(served.root, "later/p.html"), "<p>1</p>");
  await new Promise((r) => setTimeout(r, 300));
  const ev = await events(served);
  try {
    write(join(served.root, "later/p.html"), "<p>2</p>");
    await waitForAsync(async () => ev.got.some((e) => e.type === "page" && e.pages.includes("late")));
  } finally {
    await ev.close();
  }
});
