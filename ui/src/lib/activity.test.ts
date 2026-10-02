import { expect, test } from "vitest";
import { activityLines, warningLinks } from "./activity";

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
    { table: "tasks", key: "write-blog", text: 'reference "blog" not found' },
    { table: "tasks", key: null, text: "could not add new columns" },
  ]);
});
