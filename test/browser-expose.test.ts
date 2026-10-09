import { afterEach, expect, test } from "vitest";
import { expose } from "../src/browser/expose.ts";

let close: (() => void) | undefined;
let ports: MessagePort[] = [];
afterEach(() => {
  close?.();
  for (const p of ports) p.close();
  ports = [];
});

// sends one request through expose and collects what comes back until its end message
async function roundTrip(dispatch: (r: Request) => Promise<Response>): Promise<unknown[]> {
  const { port1, port2 } = new MessageChannel();
  ports = [port1, port2];
  close = expose(port2, dispatch);
  const got: unknown[] = [];
  const done = new Promise<void>((resolve) => {
    port1.onmessage = (e: MessageEvent<{ kind: string }>) => {
      const { id: _, ...m } = e.data as { id: number; kind: string };
      got.push(m);
      if (m.kind === "end") resolve();
    };
  });
  port1.postMessage({ id: 1, kind: "request", method: "GET", url: "/api/events", headers: [], body: null });
  await done;
  return got;
}

test("a failure before the head answers 500 with a JSON error", async () => {
  const got = await roundTrip(async () => {
    throw new Error("boom");
  });
  expect(got).toEqual([
    { kind: "head", status: 500, headers: [["content-type", "application/json"]] },
    { kind: "chunk", data: JSON.stringify({ error: "Error: boom" }) },
    { kind: "end" },
  ]);
});

test("a failure after the head only ends the stream, without a JSON chunk", async () => {
  const enc = new TextEncoder();
  const got = await roundTrip(async () => {
    const body = new ReadableStream<Uint8Array>({
      start(c) {
        c.enqueue(enc.encode("event: hello\ndata: {}\n\n"));
      },
      pull(c) {
        c.error(new Error("source went away"));
      },
    });
    return new Response(body, { headers: { "content-type": "text/event-stream" } });
  });
  expect(got).toEqual([
    { kind: "head", status: 200, headers: [["content-type", "text/event-stream"]] },
    { kind: "chunk", data: "event: hello\ndata: {}\n\n" },
    { kind: "end" },
  ]);
});
