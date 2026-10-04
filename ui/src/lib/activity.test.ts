import { expect, test } from "vitest";
import { activityLines, warningCounts, warningLinks, warningsByKey } from "./activity";

test("activity is newest first, one line per change", () => {
  const lines = activityLines([
    {
      type: "sync",
      at: "2026-10-02T10:00:00.000Z",
      table: "tasks",
      ok: true,
      changes: [
        { key: "a", op: "toDb" },
        { key: "b", op: "deleteFile" },
      ],
      warnings: [],
      schema: [],
    },
    { type: "conflict", at: "2026-10-02T10:01:00.000Z", table: "tasks", key: "c", winner: "file", savedTo: null },
    {
      type: "sync",
      at: "2026-10-02T10:02:00.000Z",
      table: "tasks",
      ok: false,
      error: "broken",
      changes: [],
      warnings: [],
      schema: [],
    },
    { type: "reload", at: "2026-10-02T10:03:00.000Z", tables: ["tasks"] },
  ]);
  expect(lines.map((l) => [l.symbol, l.text, l.detail])).toEqual([
    ["↻", "yamlite.yaml", "設定を再読み込み"],
    ["✗", "tasks", "broken"],
    ["⚠", "tasks / c", "コンフリクト（file を採用）"],
    ["−", "tasks / b", "削除 · DB → file"],
    ["M", "tasks / a", "file → DB"],
  ]);
});

test("warnings link to their record when they name one", () => {
  expect(warningLinks({ tasks: ['write-blog: reference "blog" not found', "could not add new columns"] })).toEqual([
    { table: "tasks", key: "write-blog", view: null, text: 'reference "blog" not found' },
    { table: "tasks", key: null, view: null, text: "could not add new columns" },
  ]);
});

test("warnings about a view name the view, not a record", () => {
  const views = new Set(["projects__milestones"]);
  expect(
    warningLinks({ projects: ['projects__milestones: owner "carol" not found in people.id (website/1)'] }, views),
  ).toEqual([
    {
      table: "projects",
      key: null,
      view: "projects__milestones",
      text: 'owner "carol" not found in people.id (website/1)',
    },
  ]);
});

test("a record's warnings are grouped by its key", () => {
  const links = warningLinks({ tasks: ["a: one", "a: two", "b: three", "plain"] });
  expect(warningsByKey(links)).toEqual(
    new Map([
      ["a", ["one", "two"]],
      ["b", ["three"]],
    ]),
  );
});

test("warning counts are per table, with a view's own warnings counted on the view", () => {
  const counts = warningCounts(
    { tasks: ["b: owner missing", "tasks__subtasks: bad", "sync slow"] },
    new Set(["tasks__subtasks"]),
  );
  expect(counts).toEqual(
    new Map([
      ["tasks", 2],
      ["tasks__subtasks", 1],
    ]),
  );
});
