import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { expect, test } from "vitest";

test("closing a database finalizes its statements, as node:sqlite does", () => {
  const path = join(mkdtempSync(join(tmpdir(), "yamlite-close-")), "db.sqlite");
  const db = new DatabaseSync(path);
  db.exec("CREATE TABLE t (v INTEGER)");
  const insert = db.prepare("INSERT INTO t (v) VALUES (?)");
  insert.run(1);
  const select = db.prepare("SELECT v FROM t");
  db.close();
  expect(() => select.all()).toThrow(expect.objectContaining({ code: "ERR_INVALID_STATE" }));
  expect(() => insert.run(2)).toThrow(/statement has been finalized/);

  // the connection is gone, not kept until the statements are collected, so the file opens anew at once
  const again = new DatabaseSync(path);
  expect(again.prepare("SELECT v FROM t").all()).toEqual([{ v: 1 }]);
  again.close();
});
