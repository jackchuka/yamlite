import { existsSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { afterEach, expect, test } from "vitest";
import { saveConflict } from "../../src/conflicts.ts";
import { read, sql, waitFor, write } from "../helpers.ts";
import { events, type Served, startServe, waitForAsync } from "./helpers.ts";

let t: Served | undefined;
afterEach(async () => {
  await t?.s.close();
  t = undefined;
});

const idOf = (path: string, table = "tasks") => encodeURIComponent(`${table}/${path.split("/").pop()}`);

test("a backup is listed with its key and restored over the winner", async () => {
  t = await startServe({ "tasks/a.yaml": "title: A\nnote: n\n" });
  const path = saveConflict(t.stateDir, "tasks", "a", { title: "OLD" }, "file", new Date(1000));
  const list = await t.api("/api/conflicts");
  expect(list.body.conflicts).toEqual([
    {
      id: `tasks/${path.split("/").pop()}`,
      table: "tasks",
      file: path.split("/").pop(),
      key: "a",
      winner: "file",
      at: "1970-01-01T00:00:01.000Z",
      restorable: true,
    },
  ]);
  const detail = await t.api(`/api/conflicts/${idOf(path)}`);
  expect(detail.body).toMatchObject({
    deleted: false,
    saved: { title: "OLD" },
    current: { id: "a", title: "A", note: "n" },
  });
  expect((await t.api(`/api/conflicts/${idOf(path)}/restore`, { method: "POST" })).status).toBe(200);
  await waitFor(() => read(join(t!.root, "tasks/a.yaml")) === "title: OLD\n");
  // the original is dismissed; what remains is the swap backup of the version it replaced
  const left = (await t.api("/api/conflicts")).body.conflicts;
  expect(left).toHaveLength(1);
  expect(left[0].id).not.toBe(`tasks/${path.split("/").pop()}`);
  expect(readdirSync(join(t.stateDir, "conflicts/tasks/dismissed"))).toHaveLength(1);
});

test("a restore backs up the winner it replaces, and that backup can be restored back", async () => {
  t = await startServe({ "tasks/a.yaml": "title: A\nnote: n\n" });
  const path = saveConflict(t.stateDir, "tasks", "a", { title: "OLD" }, "file");
  await t.api(`/api/conflicts/${idOf(path)}/restore`, { method: "POST" });
  await waitFor(() => read(join(t!.root, "tasks/a.yaml")) === "title: OLD\n");
  const [swap, ...rest] = (await t.api("/api/conflicts")).body.conflicts;
  expect(rest).toEqual([]);
  expect(swap).toMatchObject({ table: "tasks", key: "a", winner: "db", restorable: true });
  const detail = await t.api(`/api/conflicts/${encodeURIComponent(swap.id)}`);
  expect(detail.body).toMatchObject({ deleted: false, saved: { title: "A", note: "n" } });
  await t.api(`/api/conflicts/${encodeURIComponent(swap.id)}/restore`, { method: "POST" });
  await waitFor(() => read(join(t!.root, "tasks/a.yaml")) === "title: A\nnote: n\n");
  // the second swap kept the version it replaced, and the database won it
  const [again, ...others] = (await t.api("/api/conflicts")).body.conflicts;
  expect(others).toEqual([]);
  expect(again).toMatchObject({ key: "a", winner: "file" });
});

test("the swap backup names the side that lost, so its button restores the right side", async () => {
  t = await startServe({ "tasks/a.yaml": "title: A\n" });
  // the database won the conflict; the file's version was backed up
  const path = saveConflict(t.stateDir, "tasks", "a", { title: "FILE" }, "db");
  await t.api(`/api/conflicts/${idOf(path)}/restore`, { method: "POST" });
  await waitFor(() => read(join(t!.root, "tasks/a.yaml")) === "title: FILE\n");
  const [swap] = (await t.api("/api/conflicts")).body.conflicts;
  // the swap holds the old database version, so restoring it means the DB side comes back
  expect(swap).toMatchObject({ key: "a", winner: "file" });
});

test("a restore that fails leaves no swap backup behind", async () => {
  t = await startServe({ "tasks/a.yaml": "title: A\n" });
  sql(t.db, "CREATE TRIGGER no_updates BEFORE UPDATE ON tasks BEGIN SELECT RAISE(ABORT, 'locked by test'); END");
  const path = saveConflict(t.stateDir, "tasks", "a", { title: "OLD" }, "file");
  const res = await t.api(`/api/conflicts/${idOf(path)}/restore`, { method: "POST" });
  expect(res.status).toBe(400);
  const list = (await t.api("/api/conflicts")).body.conflicts;
  expect(list).toHaveLength(1);
  expect(list[0].file).toBe(path.split("/").pop());
});

test("a restore over a missing record backs up a deleted marker", async () => {
  t = await startServe({ "tasks/a.yaml": "title: A\n" });
  const path = saveConflict(t.stateDir, "tasks", "b", { title: "B" }, "file");
  await t.api(`/api/conflicts/${idOf(path)}/restore`, { method: "POST" });
  const [swap] = (await t.api("/api/conflicts")).body.conflicts;
  expect((await t.api(`/api/conflicts/${encodeURIComponent(swap.id)}`)).body).toMatchObject({ deleted: true });
});

test("a restore against a stale view is refused and changes nothing", async () => {
  t = await startServe({ "tasks/a.yaml": "title: A\n" });
  const path = saveConflict(t.stateDir, "tasks", "a", { title: "OLD" }, "file");
  const shown = (await t.api(`/api/conflicts/${idOf(path)}`)).body.current;
  sql(t.db, "UPDATE tasks SET title = 'NEWER' WHERE id = 'a'");
  await waitFor(() => read(join(t!.root, "tasks/a.yaml")) === "title: NEWER\n");
  const res = await t.api(`/api/conflicts/${idOf(path)}/restore`, { method: "POST", body: { expected: shown } });
  expect(res.status).toBe(409);
  expect(res.body.current).toMatchObject({ title: "NEWER" });
  expect(read(join(t.root, "tasks/a.yaml"))).toBe("title: NEWER\n");
  expect((await t.api("/api/conflicts")).body.conflicts).toHaveLength(1);
  const fresh = await t.api(`/api/conflicts/${idOf(path)}/restore`, {
    method: "POST",
    body: { expected: res.body.current },
  });
  expect(fresh.status).toBe(200);
});

test("restoring a deleted side deletes the record", async () => {
  t = await startServe({ "tasks/a.yaml": "title: A\n" });
  const path = saveConflict(t.stateDir, "tasks", "a", null, "db");
  expect((await t.api(`/api/conflicts/${idOf(path)}`)).body).toMatchObject({ deleted: true, saved: null });
  await t.api(`/api/conflicts/${idOf(path)}/restore`, { method: "POST" });
  await waitFor(() => !existsSync(join(t!.root, "tasks/a.yaml")));
});

test("restoring brings back a record that is gone", async () => {
  t = await startServe({ "tasks/a.yaml": "title: A\n" });
  const path = saveConflict(t.stateDir, "tasks", "b", { title: "B", n: 5n }, "file");
  await t.api(`/api/conflicts/${idOf(path)}/restore`, { method: "POST" });
  await waitFor(() => existsSync(join(t!.root, "tasks/b.yaml")));
  expect(read(join(t.root, "tasks/b.yaml"))).toBe("title: B\nn: 5\n");
});

test("backups without a header are listed but cannot be restored", async () => {
  t = await startServe({ "tasks/a.yaml": "title: A\n" });
  write(join(t.stateDir, "conflicts/tasks/x.2020-01-01T00-00-00.000Z.yaml"), "title: X\n");
  const [entry] = (await t.api("/api/conflicts")).body.conflicts;
  expect(entry).toMatchObject({ key: null, winner: null, restorable: false });
  const id = encodeURIComponent(entry.id);
  expect((await t.api(`/api/conflicts/${id}/restore`, { method: "POST" })).status).toBe(400);
  expect((await t.api(`/api/conflicts/${id}/dismiss`, { method: "POST" })).status).toBe(200);
  expect((await t.api("/api/conflicts")).body.conflicts).toEqual([]);
});

test("ids cannot leave the conflicts directory", async () => {
  t = await startServe();
  expect((await t.api(`/api/conflicts/${encodeURIComponent("../yamlite.yaml")}`)).status).toBe(404);
  expect((await t.api(`/api/conflicts/${encodeURIComponent("tasks/../../yamlite.yaml")}`)).status).toBe(404);
  expect(
    (await t.api(`/api/conflicts/${encodeURIComponent("tasks/nope.yaml")}/dismiss`, { method: "POST" })).status,
  ).toBe(404);
});

test("a real conflict is streamed and listed with its key", async () => {
  // a slow poll so that the database edit is still unseen when the file edit arrives
  t = await startServe({ "tasks/a.yaml": "title: A\n" }, undefined, { watch: { pollMs: 60_000, debounceMs: 300 } });
  const ev = await events(t);
  await waitFor(() => ev.got.some((e) => e.type === "hello"));
  sql(t.db, "UPDATE tasks SET title = 'DB' WHERE id = 'a'");
  await new Promise((r) => setTimeout(r, 50));
  write(join(t.root, "tasks/a.yaml"), "title: FILE\n");
  await waitFor(() => ev.got.some((e) => e.type === "conflict" && e.key === "a"), 5000);
  await waitForAsync(async () =>
    (await t!.api("/api/conflicts")).body.conflicts.some((c: { key: string }) => c.key === "a"),
  );
  await ev.close();
});
