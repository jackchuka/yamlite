import { join } from "node:path";
import { expect, test } from "vitest";
import { resolveConfig } from "../src/config.ts";
import { open } from "../src/index.ts";
import { dataRoot, waitFor, write } from "./helpers.ts";

const TABLES = "tables:\n  projects:\n    expand:\n      milestones: {}\n";

function rootWith(pages: string): string {
  const root = dataRoot();
  write(join(root, "yamlite.yaml"), TABLES + pages);
  write(join(root, "tasks/a.yaml"), "title: A\n");
  write(join(root, "projects/p.yaml"), "title: P\nmilestones:\n  - title: M\n");
  return root;
}

const pagesOf = (pages: string) => resolveConfig({ root: rootWith(pages) }).pages;

test("a declared page resolves its path, title and permissions", () => {
  const root = rootWith(
    "pages:\n  board:\n    path: .pages/kanban.html\n    title: タスクボード\n" +
      "    access: { tasks: write, projects__milestones: read }\n    sql: true\n" +
      "    network: [https://cdn.jsdelivr.net]\n",
  );
  expect(resolveConfig({ root }).pages).toEqual([
    {
      name: "board",
      path: join(root, ".pages/kanban.html"),
      title: "タスクボード",
      access: { tasks: "write", projects__milestones: "read" },
      sql: true,
      network: ["https://cdn.jsdelivr.net"],
    },
  ]);
});

test("a page allows nothing unless it says so, and is titled by its name", () => {
  expect(pagesOf("pages:\n  board:\n    path: b.html\n")[0]).toMatchObject({
    title: "board",
    access: {},
    sql: false,
    network: [],
  });
});

test("no pages key means no pages", () => {
  expect(pagesOf("")).toEqual([]);
});

test("a trailing slash on an origin is dropped", () => {
  expect(pagesOf("pages:\n  b:\n    path: b.html\n    network: [https://cdn.example.com/]\n")[0]?.network).toEqual([
    "https://cdn.example.com",
  ]);
});

test.each([
  ["pages: [a]\n", "pages must be a map of page names"],
  ["pages:\n  Board:\n    path: b.html\n", 'invalid page name: "Board"'],
  ["pages:\n  b:\n    path: b.html\n    theme: dark\n", 'page "b": unknown key "theme"'],
  ["pages:\n  b: {}\n", 'page "b": path is required'],
  ["pages:\n  b: x.html\n", 'page "b": must be a map with a path'],
  ["pages:\n  b:\n    path: b.htm\n", 'page "b": path must be an .html file'],
  ["pages:\n  b:\n    path: b.html\n    title: 1\n", 'page "b": title must be a string'],
  ["pages:\n  b:\n    path: b.html\n    sql: yes\n", 'page "b": sql must be true or false'],
  [
    "pages:\n  b:\n    path: b.html\n    access: [tasks]\n",
    'page "b": access must be a map of tables to read or write',
  ],
  ["pages:\n  b:\n    path: b.html\n    access: { tasks: admin }\n", 'page "b": access.tasks must be read or write'],
  [
    "pages:\n  b:\n    path: b.html\n    access: { people: read }\n",
    'page "b": unknown table or view "people" in access',
  ],
  [
    "pages:\n  b:\n    path: b.html\n    access: { projects__milestones: write }\n",
    'page "b": view "projects__milestones" can only be read',
  ],
  [
    "pages:\n  b:\n    path: b.html\n    access: { _yamlite_state: read }\n",
    'page "b": _yamlite_state is yamlite\'s bookkeeping and cannot be in access',
  ],
  ["pages:\n  b:\n    path: b.html\n    network: https://a.example\n", 'page "b": network must be a list of origins'],
  [
    "pages:\n  b:\n    path: b.html\n    network: [https://cdn.example.com/lib.js]\n",
    "network entries must be origins",
  ],
  ["pages:\n  b:\n    path: b.html\n    network: ['https://*.example.com']\n", "network entries must be origins"],
  ["pages:\n  b:\n    path: b.html\n    network: [ftp://example.com]\n", "network entries must be origins"],
])("rejects %j", (pages, message) => {
  expect(() => pagesOf(pages)).toThrow(message);
});

test("watch picks up a page added to yamlite.yaml", async () => {
  const root = rootWith("");
  const y = await open({ root });
  try {
    const w = y.watch({}, { pollMs: 50, debounceMs: 50 });
    await w.ready;
    expect(y.pages).toEqual([]);
    write(join(root, "yamlite.yaml"), `${TABLES}pages:\n  board:\n    path: b.html\n    access: { tasks: read }\n`);
    await waitFor(() => y.pages.length === 1);
    expect(y.pages[0]?.access).toEqual({ tasks: "read" });
  } finally {
    await y.close();
  }
});

test("a reload whose page names a missing table keeps the previous configuration", async () => {
  const root = rootWith("pages:\n  board:\n    path: b.html\n    access: { projects: read }\n");
  const y = await open({ root });
  const errors: string[] = [];
  try {
    const w = y.watch({ onError: (e) => errors.push(e.message) }, { pollMs: 50, debounceMs: 50 });
    await w.ready;
    write(join(root, "yamlite.yaml"), `${TABLES}pages:\n  board:\n    path: b.html\n    access: { nope: read }\n`);
    await waitFor(() => errors.some((m) => m.includes('unknown table or view "nope"')));
    expect(errors.find((m) => m.includes("nope"))).toMatch(/keeping the previous configuration$/);
    expect(y.pages[0]?.access).toEqual({ projects: "read" });
  } finally {
    await y.close();
  }
});
