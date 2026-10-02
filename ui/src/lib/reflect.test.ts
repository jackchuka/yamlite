import { expect, test } from "vitest";
import { reflectKey, reflectReducer, WAIT_MS } from "./reflect";
import type { ServeEvent } from "./types";

const fileOf = (table: string, key: string) => `${table}/${key}.yaml`;
const k = reflectKey("tasks", "a");
const sync = (over: Partial<Extract<ServeEvent, { type: "sync" }>>): ServeEvent => ({
  type: "sync",
  at: "t",
  table: "tasks",
  ok: true,
  changes: [],
  warnings: [],
  schema: [],
  ...over,
});
const saved = reflectReducer({}, { type: "saved", table: "tasks", key: "a", at: 1000 }, fileOf);

test("a save is pending until the file is written", () => {
  expect(saved[k]).toEqual({ state: "pending", since: 1000 });
  const next = reflectReducer(saved, { type: "event", event: sync({ changes: [{ key: "a", op: "toFile" }] }) }, fileOf);
  expect(next[k]).toEqual({ state: "applied", file: "tasks/a.yaml" });
});

test("a delete counts as applied", () => {
  const next = reflectReducer(
    saved,
    { type: "event", event: sync({ changes: [{ key: "a", op: "deleteFile" }] }) },
    fileOf,
  );
  expect(next[k]?.state).toBe("applied");
});

test("a warning about the key fails it with the reason", () => {
  const next = reflectReducer(
    saved,
    { type: "event", event: sync({ warnings: ["b: other", "a: file changed during sync; will retry"] }) },
    fileOf,
  );
  expect(next[k]).toEqual({ state: "failed", reason: "file changed during sync; will retry" });
});

test("a failed table sync fails every pending key of that table", () => {
  const next = reflectReducer(saved, { type: "event", event: sync({ ok: false, error: "broken file" }) }, fileOf);
  expect(next[k]).toEqual({ state: "failed", reason: "broken file" });
});

test("other tables and other keys are left alone", () => {
  const other = reflectReducer(
    saved,
    { type: "event", event: sync({ table: "people", changes: [{ key: "a", op: "toFile" }] }) },
    fileOf,
  );
  expect(other[k]?.state).toBe("pending");
});

test("a save with no event for a while is waiting", () => {
  expect(reflectReducer(saved, { type: "tick", now: 1000 + WAIT_MS - 1 }, fileOf)[k]?.state).toBe("pending");
  const waiting = reflectReducer(saved, { type: "tick", now: 1000 + WAIT_MS }, fileOf);
  expect(waiting[k]).toEqual({ state: "waiting" });
  const late = reflectReducer(
    waiting,
    { type: "event", event: sync({ changes: [{ key: "a", op: "toFile" }] }) },
    fileOf,
  );
  expect(late[k]?.state).toBe("applied");
});

test("a failed request drops its pending entry", () => {
  const next = reflectReducer(saved, { type: "cancelled", table: "tasks", key: "a" }, fileOf);
  expect(next[k]).toBeUndefined();
});
