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

test("interleaved bodies each decode their own split characters, and a cut-off one is flushed", async () => {
  const { port1, port2 } = new MessageChannel();
  ports = [port1, port2];
  const controllers = new Map<string, ReadableStreamDefaultController<Uint8Array>>();
  close = expose(port2, async (r) => {
    const body = new ReadableStream<Uint8Array>({
      start: (c) => void controllers.set(new URL(r.url).pathname, c),
    });
    return new Response(body);
  });
  const text = new Map<number, string>();
  const ended = new Set<number>();
  let seen = 0;
  port1.onmessage = (e: MessageEvent<{ id: number; kind: string; data?: string }>) => {
    const m = e.data;
    if (m.kind === "chunk") text.set(m.id, (text.get(m.id) ?? "") + m.data);
    if (m.kind === "end") ended.add(m.id);
    seen++;
  };
  const until = async (ok: () => boolean) => {
    while (!ok()) await new Promise((r) => setTimeout(r, 1));
  };
  const request = (id: number, url: string) =>
    port1.postMessage({ id, kind: "request", method: "GET", url, headers: [], body: null });
  request(1, "/a");
  request(2, "/b");
  await until(() => controllers.size === 2 && seen >= 2);
  const send = async (path: string, bytes: number[]) => {
    const before = seen;
    controllers.get(path)!.enqueue(new Uint8Array(bytes));
    await until(() => seen > before);
  };
  // "é" is C3 A9 and "日" is E6 97 A5; each is split across two chunks, alternating between the responses
  await send("/a", [0x61, 0xc3]);
  await send("/b", [0x62, 0xe6]);
  await send("/a", [0xa9]);
  await send("/b", [0x97, 0xa5, 0xe6]);
  controllers.get("/a")!.close();
  controllers.get("/b")!.close();
  await until(() => ended.size === 2);
  expect(text.get(1)).toBe("aé");
  // the trailing lone lead byte is flushed as a replacement character, not dropped
  expect(text.get(2)).toBe("b日�");
});
