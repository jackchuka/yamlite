import { expect, test } from "vitest";
import { needsConfirm } from "./sqlguard";

test("destructive statements ask first", () => {
  expect(needsConfirm("drop table tasks")).toMatch(/DROP/);
  expect(needsConfirm("delete from tasks")).toMatch(/WHERE/);
  expect(needsConfirm("update tasks set done = 1")).toMatch(/WHERE/);
  expect(needsConfirm("update tasks set note = 'no where here'")).toMatch(/WHERE/);
});

test("everything else runs directly", () => {
  expect(needsConfirm("delete from tasks where id = 'a'")).toBeNull();
  expect(needsConfirm("UPDATE tasks SET done = 1 WHERE done = 0")).toBeNull();
  expect(needsConfirm("select * from tasks")).toBeNull();
  expect(needsConfirm("insert into tasks (id) values ('x')")).toBeNull();
});
