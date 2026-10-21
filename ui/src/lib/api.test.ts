import { expect, test, vi } from "vitest";
import { ApiError, httpApi, request, session } from "./api";
import { setTransport, transport } from "./transport";

const reply = (status: number, body: unknown) =>
  new Response(body === null ? "" : JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

test("a busy database is retried, then succeeds", async () => {
  const fetcher = vi
    .fn<typeof fetch>()
    .mockResolvedValueOnce(reply(503, { error: "busy" }))
    .mockResolvedValueOnce(reply(503, { error: "busy" }))
    .mockResolvedValueOnce(reply(200, { ok: true }));
  await expect(request("GET", "/api/x", undefined, { fetcher, retryDelayMs: 0 })).resolves.toEqual({ ok: true });
  expect(fetcher).toHaveBeenCalledTimes(3);
});

test("a busy database gives up after three retries", async () => {
  const fetcher = vi.fn<typeof fetch>().mockImplementation(async () => reply(503, { error: "busy" }));
  await expect(request("GET", "/api/x", undefined, { fetcher, retryDelayMs: 0 })).rejects.toMatchObject({
    status: 503,
  });
  expect(fetcher).toHaveBeenCalledTimes(4);
});

test("errors carry the server's message and body", async () => {
  const fetcher = vi.fn<typeof fetch>().mockResolvedValue(reply(409, { error: "stale", stale: ["title"] }));
  const err = await request("PATCH", "/api/x", { a: 1 }, { fetcher }).catch((e: unknown) => e);
  expect(err).toBeInstanceOf(ApiError);
  expect(err).toMatchObject({ status: 409, message: "stale", body: { stale: ["title"] } });
  const init = fetcher.mock.calls[0]?.[1];
  expect(init?.body).toBe('{"a":1}');
});

test("a 401 marks the session as expired once", async () => {
  const listener = vi.fn();
  const off = session.subscribe(listener);
  const fetcher = vi.fn<typeof fetch>().mockResolvedValue(reply(401, { error: "missing or wrong token" }));
  await request("GET", "/api/x", undefined, { fetcher }).catch(() => {});
  await request("GET", "/api/x", undefined, { fetcher }).catch(() => {});
  expect(session.expired()).toBe(true);
  expect(listener).toHaveBeenCalledTimes(1);
  off();
});

test("a non-JSON 401 still expires the session and rejects with ApiError", async () => {
  const fetcher = vi.fn<typeof fetch>().mockResolvedValue(new Response("unauthorized", { status: 401 }));
  const err = await request("GET", "/api/x", undefined, { fetcher }).catch((e: unknown) => e);
  expect(err).toBeInstanceOf(ApiError);
  expect(err).toMatchObject({ status: 401, message: "unauthorized" });
  expect(session.expired()).toBe(true);
});

test("a non-JSON 502 rejects with ApiError carrying the text", async () => {
  const fetcher = vi.fn<typeof fetch>().mockResolvedValue(new Response("<html>Bad Gateway</html>", { status: 502 }));
  const err = await request("GET", "/api/x", undefined, { fetcher }).catch((e: unknown) => e);
  expect(err).toBeInstanceOf(ApiError);
  expect(err).toMatchObject({ status: 502, message: "<html>Bad Gateway</html>" });
});

function sse(chunks: string[], status = 200) {
  const encoder = new TextEncoder();
  const body = new ReadableStream<Uint8Array>({
    start(k) {
      for (const c of chunks) k.enqueue(encoder.encode(c));
      k.close();
    },
  });
  return new Response(body, { status, headers: { "content-type": "text/event-stream" } });
}

async function collect(it: AsyncIterable<string>): Promise<string[]> {
  const out: string[] = [];
  for await (const t of it) out.push(t);
  return out;
}

function withFetch(fetcher: typeof fetch, run: () => Promise<void>) {
  const before = transport();
  setTransport({ ...before, fetch: fetcher });
  return run().finally(() => setTransport(before));
}

test("pageAi posts once and a 503 is not retried", async () => {
  const fetcher = vi
    .fn<typeof fetch>()
    .mockResolvedValue(reply(503, { error: "no AI key is configured on this host", code: "no_key" }));
  await withFetch(fetcher, async () => {
    const err = await httpApi.pageAi("board", { prompt: "hi" }).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ApiError);
    expect(err).toMatchObject({ status: 503, body: { code: "no_key" } });
  });
  expect(fetcher).toHaveBeenCalledTimes(1);
  expect(fetcher.mock.calls[0]?.[0]).toBe("/api/pages/board/ai");
  expect(fetcher.mock.calls[0]?.[1]?.body).toBe('{"prompt":"hi"}');
});

test("pageAi answers with the server's body", async () => {
  const fetcher = vi.fn<typeof fetch>().mockResolvedValue(reply(200, { object: { n: 1 } }));
  await withFetch(fetcher, async () => {
    await expect(httpApi.pageAi("board", { prompt: "hi", schema: {} })).resolves.toEqual({ object: { n: 1 } });
  });
});

test("pageAiStream yields deltas split anywhere across chunks, skipping pings, until done", async () => {
  const fetcher = vi
    .fn<typeof fetch>()
    .mockResolvedValue(
      sse([
        'event: delta\ndata: {"text":"Hel',
        'lo"}\n\n: ping\n\nevent: delta\r\ndata: {"text":", world"}\r\n\r\n',
        'event: done\ndata: {}\n\nevent: delta\ndata: {"text":"after"}\n\n',
      ]),
    );
  const signal = new AbortController().signal;
  await withFetch(fetcher, async () => {
    expect(await collect(httpApi.pageAiStream("board", { prompt: "hi" }, signal))).toEqual(["Hello", ", world"]);
  });
  expect(fetcher.mock.calls[0]?.[0]).toBe("/api/pages/board/ai/stream");
  expect(fetcher.mock.calls[0]?.[1]?.signal).toBe(signal);
});

test("pageAiStream throws an error event as an ApiError with its status and extra", async () => {
  const fetcher = vi
    .fn<typeof fetch>()
    .mockResolvedValue(
      sse([
        'event: delta\ndata: {"text":"a"}\n\n',
        'event: error\ndata: {"error":"slow down","provider":"anthropic","retryAfter":3,"status":429}\n\n',
      ]),
    );
  const seen: string[] = [];
  await withFetch(fetcher, async () => {
    const err = await (async () => {
      for await (const t of httpApi.pageAiStream("board", { prompt: "hi" }, new AbortController().signal)) seen.push(t);
    })().catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ApiError);
    expect(err).toMatchObject({
      status: 429,
      message: "slow down",
      body: { error: "slow down", provider: "anthropic", retryAfter: 3 },
    });
  });
  expect(seen).toEqual(["a"]);
});

test("pageAiStream throws a refusal before the stream as an ApiError, without retrying", async () => {
  const fetcher = vi.fn<typeof fetch>().mockResolvedValue(reply(503, { error: "no key", code: "no_key" }));
  await withFetch(fetcher, async () => {
    const err = await collect(httpApi.pageAiStream("board", { prompt: "hi" }, new AbortController().signal)).catch(
      (e: unknown) => e,
    );
    expect(err).toMatchObject({ status: 503, body: { code: "no_key" } });
  });
  expect(fetcher).toHaveBeenCalledTimes(1);
});

test("pageAiStream fails when the stream ends without done", async () => {
  const fetcher = vi.fn<typeof fetch>().mockResolvedValue(sse(['event: delta\ndata: {"text":"a"}\n\n']));
  await withFetch(fetcher, async () => {
    const err = await collect(httpApi.pageAiStream("board", { prompt: "hi" }, new AbortController().signal)).catch(
      (e: unknown) => e,
    );
    expect(err).toBeInstanceOf(ApiError);
    expect(err).toMatchObject({ status: 502 });
  });
});
