import { expect, test } from "vitest";
import type { Workspace } from "../../src/serve/workspace.ts";
import { tasksWorkspace } from "./helpers.ts";

const call = (w: Workspace, path: string, init: RequestInit = {}) =>
  w.router.dispatch(new Request(`http://x${path}`, init));
const patch = (body: unknown): RequestInit => ({
  method: "PATCH",
  headers: { "content-type": "application/json" },
  body: JSON.stringify(body),
});

test("dispatch answers a GET with JSON", async () => {
  const { w } = await tasksWorkspace();
  const res = await call(w, "/api/meta");
  expect(res.status).toBe(200);
  expect(res.headers.get("content-type")).toMatch(/^application\/json/);
  expect((await res.json()).tables.map((t: { name: string }) => t.name)).toContain("tasks");
});

test("an HttpError keeps its extra fields", async () => {
  const { w } = await tasksWorkspace();
  const res = await call(w, "/api/tables/tasks/rows/a", patch({ values: { title: "C" }, base: { title: "stale" } }));
  expect(res.status).toBe(409);
  const body = await res.json();
  expect(body.stale).toEqual(["title"]);
  expect(body.current.title).toBe("A");
});

test("a write without JSON content type is refused", async () => {
  const { w } = await tasksWorkspace();
  const res = await call(w, "/api/sql", { method: "POST", body: "select 1" });
  expect(res.status).toBe(415);
});

test("unknown paths and methods", async () => {
  const { w } = await tasksWorkspace();
  expect((await call(w, "/api/nope")).status).toBe(404);
  expect((await call(w, "/api/meta", { method: "DELETE" })).status).toBe(405);
});

test("events stream hello first, and stop when the request is aborted", async () => {
  const { w } = await tasksWorkspace();
  const ac = new AbortController();
  const res = await call(w, "/api/events", { signal: ac.signal });
  expect(res.headers.get("content-type")).toMatch(/^text\/event-stream/);
  const reader = res.body!.getReader();
  expect(new TextDecoder().decode((await reader.read()).value)).toMatch(/^event: hello\n/);
  ac.abort();
  expect((await reader.read()).done).toBe(true);
  expect((w.context.hub as unknown as { clients: Map<unknown, unknown> }).clients.size).toBe(0);
});

test("a body over 1 MiB is refused with 413", async () => {
  const { w } = await tasksWorkspace();
  const big = JSON.stringify({ sql: "x".repeat(1_100_000) });
  const res = await call(w, "/api/sql", { method: "POST", headers: { "content-type": "application/json" }, body: big });
  expect(res.status).toBe(413);
});

test("a streamed body is cut off once it passes 1 MiB", async () => {
  const { w } = await tasksWorkspace();
  const chunk = new Uint8Array(512 * 1024);
  let sent = 0;
  const body = new ReadableStream<Uint8Array>({
    pull(c) {
      sent++;
      c.enqueue(chunk);
      if (sent > 20) c.close();
    },
  });
  const res = await call(w, "/api/sql", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body,
    duplex: "half",
  } as RequestInit);
  expect(res.status).toBe(413);
  expect(sent).toBeLessThan(10);
});
