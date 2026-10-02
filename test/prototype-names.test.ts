import { join } from "node:path";
import { expect, test } from "vitest";
import { generateConfig } from "../src/init.ts";
import { open } from "../src/index.ts";
import { read, sql, tmpRoot, write } from "./helpers.ts";

// field names that are also Object.prototype members must behave like any other name
test("fields named constructor, toString or valueOf sync both ways", async () => {
  const root = tmpRoot();
  write(join(root, "yamlite.yaml"), "tables:\n  tasks:\n    columns: { valueOf: INTEGER }\n");
  write(join(root, "tasks/a.yaml"), "title: A\nconstructor: x\ntoString: 1\nvalueOf: 2\n");
  write(join(root, "tasks/b.yaml"), "title: B\n");
  const db = join(root, ".yamlite", "db.sqlite");
  const y = await open({ root });
  expect((await y.sync())[0]).toMatchObject({ ok: true, toDb: 2 });
  expect(sql(db, `SELECT id, "constructor", "toString", "valueOf" FROM tasks ORDER BY id`)).toEqual([
    { id: "a", constructor: "x", toString: 1, valueOf: 2 },
    { id: "b", constructor: null, toString: null, valueOf: null },
  ]);
  expect((await y.sync())[0]).toMatchObject({ ok: true, changes: [] });

  sql(db, `UPDATE tasks SET "constructor" = 'y' WHERE id = 'a'`);
  expect((await y.sync())[0]).toMatchObject({ ok: true, toFile: 1 });
  expect(read(join(root, "tasks/a.yaml"))).toBe("title: A\nconstructor: y\ntoString: 1\nvalueOf: 2\n");

  sql(db, `UPDATE tasks SET "constructor" = NULL WHERE id = 'a'`);
  expect((await y.sync())[0]).toMatchObject({ ok: true, toFile: 1 });
  expect(read(join(root, "tasks/a.yaml"))).toBe("title: A\ntoString: 1\nvalueOf: 2\n");
  await y.close();
});

test("init infers the type of a column named like a prototype member", () => {
  const root = tmpRoot();
  write(join(root, "tasks/a.yaml"), "toString: 1\nconstructor: x\n");
  expect(generateConfig({ root })).toContain("      toString: INTEGER\n      constructor: TEXT\n");
});
