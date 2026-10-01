import { describe, expect, test } from "vitest";
import type { TableResult } from "../src/engine.ts";
import { displayPath, plain, reloadLine, report, watchEvents, watchHeader } from "../src/format.ts";

const result = (o: Partial<TableResult>): TableResult => ({
  table: "tasks",
  ok: true,
  records: 0,
  changes: [],
  schema: [],
  registered: [],
  toDb: 0,
  toFile: 0,
  deletedDb: 0,
  deletedFile: 0,
  conflicts: [],
  warnings: [],
  ...o,
});

const root = "/data/notes";

describe("displayPath", () => {
  test("abbreviates the home directory", () => {
    expect(displayPath("/home/me/notes", "/home/me")).toBe("~/notes");
    expect(displayPath("/data/notes", "/home/me")).toBe("/data/notes");
  });
});

describe("report", () => {
  test("status lists tables, details and a pending summary", () => {
    const out = report(
      [
        result({ table: "people", records: 2 }),
        result({
          records: 4,
          toDb: 1,
          toFile: 1,
          warnings: ['write-blog: "title" must be a scalar (column type TEXT); this file is not synced'],
          conflicts: [{ table: "tasks", key: "buy-milk", winner: "db", savedTo: null }],
        }),
      ],
      { mode: "status", root, paint: plain },
    );
    expect(out).toBe(
      [
        "yamlite · /data/notes",
        "",
        "  ✓ people   in sync                               2 records",
        "  ● tasks    1 → db · 1 → file · 1 conflict        4 records",
        '             ! write-blog: "title" must be a scalar (column type TEXT); this file is not synced',
        "             ⚠ buy-milk: changed on both sides · db will win",
        "",
        "  2 changes pending · 1 conflict · run yamlite sync to apply",
      ].join("\n"),
    );
  });

  test("status says when everything is in sync", () => {
    const out = report([result({ records: 1 })], { mode: "status", root, paint: plain });
    expect(out.split("\n").at(-1)).toBe("  Everything is in sync");
  });

  test("sync shows conflicts with their backup and errors, and a timed summary", () => {
    const out = report(
      [
        result({
          records: 4,
          toDb: 1,
          deletedFile: 2,
          conflicts: [
            { table: "tasks", key: "buy-milk", winner: "db", savedTo: "/data/notes/.yamlite/conflicts/tasks/b.yaml" },
          ],
        }),
        result({ table: "notes", ok: false, error: '"title" mixes scalar and map/list values' }),
      ],
      { mode: "sync", root, paint: plain, elapsedMs: 34 },
    );
    expect(out).toBe(
      [
        "yamlite · /data/notes",
        "",
        "  ✓ tasks   1 → db · 2 files deleted · 1 conflict  4 records",
        "            ⚠ buy-milk: changed on both sides · kept db · file version saved to .yamlite/conflicts/tasks/b.yaml",
        '  ✗ notes   "title" mixes scalar and map/list values',
        "",
        "  Synced 2 tables in 34ms · 3 changes · 1 conflict · 1 error",
      ].join("\n"),
    );
  });

  test("sync with nothing to do", () => {
    const out = report([result({ records: 1 })], { mode: "sync", root, paint: plain, elapsedMs: 5 });
    expect(out.split("\n").at(-1)).toBe("  Synced 1 table in 5ms · no changes");
  });
});

describe("watch", () => {
  const now = new Date(2026, 9, 1, 12, 3, 41);

  test("header", () => {
    expect(watchHeader(["people", "tasks"], root, plain)).toBe(
      "yamlite · watching people, tasks in /data/notes · Ctrl-C to stop",
    );
  });

  test("one line per change, conflict and warning", () => {
    const lines = watchEvents(
      result({
        changes: [
          { key: "buy-milk", op: "toDb" },
          { key: "write-blog", op: "toFile" },
          { key: "old", op: "deleteDb" },
          { key: "gone", op: "deleteFile" },
        ],
        conflicts: [
          { table: "tasks", key: "x", winner: "file", savedTo: "/data/notes/.yamlite/conflicts/tasks/x.yaml" },
        ],
        warnings: ["y: skipped"],
      }),
      { root, now, paint: plain, quiet: false },
    );
    expect(lines).toEqual([
      "  12:03:41  tasks  → db        buy-milk",
      "  12:03:41  tasks  → file      write-blog",
      "  12:03:41  tasks  − row       old",
      "  12:03:41  tasks  − file      gone",
      "  12:03:41  tasks  ⚠ conflict  x · kept file · db version saved to .yamlite/conflicts/tasks/x.yaml",
      "  12:03:41  tasks  ! warning   y: skipped",
    ]);
  });

  test("quiet keeps only conflicts and errors", () => {
    const opts = { root, now, paint: plain, quiet: true };
    expect(watchEvents(result({ changes: [{ key: "a", op: "toDb" }], warnings: ["w"] }), opts)).toEqual([]);
    expect(watchEvents(result({ ok: false, error: "boom" }), opts)).toEqual(["  12:03:41  tasks  ✗ error     boom"]);
  });
});

describe("index changes", () => {
  const schema = [
    { op: "createIndex" as const, name: "yamlite_tasks_a", definition: "(done, priority)" },
    { op: "dropIndex" as const, name: "yamlite_tasks_b", definition: "yamlite_tasks_b" },
  ];

  test("status marks the table pending and lists each index change", () => {
    const out = report([result({ records: 1, schema })], { mode: "status", root, paint: plain });
    expect(out.split("\n").slice(2)).toEqual([
      "  ● tasks   2 index changes                       1 record",
      "            + index (done, priority)",
      "            − index yamlite_tasks_b",
      "",
      "  2 index changes pending · run yamlite sync to apply",
    ]);
  });

  test("sync counts them in the summary", () => {
    const out = report([result({ records: 1, toDb: 1, schema: schema.slice(0, 1) })], {
      mode: "sync",
      root,
      paint: plain,
      elapsedMs: 3,
    });
    expect(out.split("\n").at(-1)).toBe("  Synced 1 table in 3ms · 1 change · 1 index change");
  });

  test("watch prints one line per index change", () => {
    const lines = watchEvents(result({ schema }), {
      root,
      now: new Date(2026, 9, 1, 12, 3, 41),
      paint: plain,
      quiet: false,
    });
    expect(lines).toEqual([
      "  12:03:41  tasks  + index     (done, priority)",
      "  12:03:41  tasks  − index     yamlite_tasks_b",
    ]);
  });
});

describe("column type changes", () => {
  const schema = [
    { op: "alterColumn" as const, name: "title", definition: "TEXT → JSON" },
    { op: "createIndex" as const, name: "yamlite_tasks_a", definition: "(done)" },
  ];

  test("report shows them separately from index changes", () => {
    const out = report([result({ records: 1, schema })], { mode: "status", root, paint: plain });
    expect(out.split("\n").slice(2)).toEqual([
      "  ● tasks   1 column change · 1 index change      1 record",
      "            ↻ column title TEXT → JSON (table will be rebuilt)",
      "            + index (done)",
      "",
      "  1 column change · 1 index change pending · run yamlite sync to apply",
    ]);
    const synced = report([result({ records: 1, schema })], { mode: "sync", root, paint: plain, elapsedMs: 2 });
    expect(synced.split("\n")[3]).toBe("            ↻ column title TEXT → JSON (table rebuilt)");
  });

  test("watch", () => {
    const lines = watchEvents(result({ schema: schema.slice(0, 1) }), {
      root,
      now: new Date(2026, 9, 1, 12, 3, 41),
      paint: plain,
      quiet: false,
    });
    expect(lines).toEqual(["  12:03:41  tasks  ↻ column    title TEXT → JSON"]);
  });
});

test("reload line", () => {
  expect(reloadLine(["notes", "tasks"], new Date(2026, 9, 1, 9, 5, 7), plain)).toBe(
    "  09:05:07  ↻ reloaded config · watching notes, tasks",
  );
});

describe("registered columns", () => {
  const registered = [{ column: "prio", type: "INTEGER" as const }];

  test("report lists them and counts them", () => {
    const status = report([result({ records: 1, registered })], { mode: "status", root, paint: plain });
    expect(status.split("\n").slice(2)).toEqual([
      "  ● tasks   1 new column                          1 record",
      "            + column prio INTEGER (will be added to yamlite.yaml)",
      "",
      "  1 new column pending · run yamlite sync to apply",
    ]);
    const synced = report([result({ records: 1, registered })], { mode: "sync", root, paint: plain, elapsedMs: 1 });
    expect(synced.split("\n")[3]).toBe("            + column prio INTEGER (added to yamlite.yaml)");
    expect(synced.split("\n").at(-1)).toBe("  Synced 1 table in 1ms · 1 new column");
  });

  test("watch", () => {
    const lines = watchEvents(result({ registered }), {
      root,
      now: new Date(2026, 9, 1, 12, 3, 41),
      paint: plain,
      quiet: false,
    });
    expect(lines).toEqual(["  12:03:41  tasks  + column    prio INTEGER"]);
  });
});

test("dropped columns", () => {
  const schema = [{ op: "dropColumn" as const, name: "old", definition: "old" }];
  const status = report([result({ records: 1, schema })], { mode: "status", root, paint: plain });
  expect(status.split("\n").slice(2, 4)).toEqual([
    "  ● tasks   1 column change                       1 record",
    "            − column old (removed from yamlite.yaml)",
  ]);
  const lines = watchEvents(result({ schema }), {
    root,
    now: new Date(2026, 9, 1, 12, 3, 41),
    paint: plain,
    quiet: false,
  });
  expect(lines).toEqual(["  12:03:41  tasks  − column    old"]);
});
