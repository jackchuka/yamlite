import { expect, test } from "vitest";
import { expose } from "../../../src/browser/expose.ts";
import { createWorkerTransport } from "./workerTransport";

function pair(dispatch: (r: Request) => Promise<Response>) {
  const { port1, port2 } = new MessageChannel();
  const stop = expose(port2, dispatch);
  return {
    t: createWorkerTransport(port1),
    stop,
    close: () => {
      stop();
      port1.close();
      port2.close();
    },
  };
}

const enc = new TextEncoder();

test("fetch round-trips method, body, status, headers and JSON", async () => {
  const { t, close } = pair(async (r) =>
    Response.json({ method: r.method, body: await r.json(), path: new URL(r.url).pathname }, { status: 201 }),
  );
  const res = await t.fetch("/api/rows", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: '{"a":1}',
  });
  expect(res.status).toBe(201);
  expect(await res.json()).toEqual({ method: "POST", body: { a: 1 }, path: "/api/rows" });
  close();
});

test("a dispatch failure answers 500 with the head sent", async () => {
  const { t, close } = pair(async () => {
    throw new Error("boom");
  });
  const res = await t.fetch("/api/x");
  expect(res.status).toBe(500);
  expect(await res.json()).toEqual({ error: "Error: boom" });
  close();
});

test("eventSource delivers named events and stops the stream on close", async () => {
  let cancelled = false;
  const { t, close } = pair(async (r) => {
    const body = new ReadableStream<Uint8Array>({
      start(c) {
        c.enqueue(enc.encode('event: hello\ndata: {"x":1}\n\n'));
        c.enqueue(enc.encode("event: sync\ndata: 2\n"));
        c.enqueue(enc.encode("\n"));
        r.signal.addEventListener("abort", () => {
          cancelled = true;
          c.close();
        });
      },
    });
    return new Response(body, { headers: { "content-type": "text/event-stream" } });
  });
  const es = t.eventSource("/api/events");
  let errors = 0;
  es.addEventListener("error", () => errors++);
  const got: string[] = [];
  await new Promise<void>((done) => {
    es.addEventListener("hello", (e) => got.push(`hello ${(e as MessageEvent).data}`));
    es.addEventListener("sync", (e) => {
      got.push(`sync ${(e as MessageEvent).data}`);
      done();
    });
  });
  expect(got).toEqual(['hello {"x":1}', "sync 2"]);
  es.close();
  await new Promise((r) => setTimeout(r, 10));
  expect(cancelled).toBe(true);
  expect(errors).toBe(0);
  close();
});

test("eventSource fires error when the stream ends without close", async () => {
  const { t, close } = pair(
    async () => new Response(enc.encode(": ping\n\n"), { headers: { "content-type": "text/event-stream" } }),
  );
  const es = t.eventSource("/api/events");
  await new Promise<void>((done) => es.addEventListener("error", () => done()));
  expect(es.readyState).toBe(2);
  close();
});

test("on* properties are called like a real EventSource", async () => {
  const { t, close } = pair(
    async () => new Response(enc.encode("data: hi\n\n"), { headers: { "content-type": "text/event-stream" } }),
  );
  const es = t.eventSource("/api/events");
  const seen: string[] = [];
  es.onopen = () => seen.push("open");
  es.onmessage = (e) => seen.push(`message ${e.data}`);
  await new Promise<void>((done) => {
    es.onerror = () => {
      seen.push("error");
      done();
    };
  });
  expect(seen).toEqual(["open", "message hi", "error"]);
  expect([es.CONNECTING, es.OPEN, es.CLOSED]).toEqual([0, 1, 2]);
  close();
});

test("close before the head arrives stays closed", async () => {
  const { t, close } = pair(async () => new Response("", { headers: { "content-type": "text/event-stream" } }));
  const es = t.eventSource("/api/events");
  const seen: string[] = [];
  es.addEventListener("open", () => seen.push("open"));
  es.addEventListener("error", () => seen.push("error"));
  es.close();
  await new Promise((r) => setTimeout(r, 20));
  expect(seen).toEqual([]);
  expect(es.readyState).toBe(2);
  close();
});
