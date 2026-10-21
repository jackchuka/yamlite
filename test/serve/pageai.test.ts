import { APICallError } from "ai";
import { MockLanguageModelV4 } from "ai/test";
import { afterEach, expect, test } from "vitest";
import { hanging, type Reply, scripted } from "../agent/model.ts";
import { type Served, startServe, waitForAsync } from "./helpers.ts";

let t: Served | undefined;
afterEach(async () => {
  await t?.s.close();
  t = undefined;
});

const CONFIG = `tables:
  tasks: {}
pages:
  board:
    path: b.html
    access: { tasks: read }
  helper:
    path: b.html
    access: { tasks: read }
    ai: true
  capped:
    path: b.html
    access: { tasks: read }
    ai: { maxOutputTokens: 100 }
`;
const FILES = { "tasks/a.yaml": "title: A\n", "b.html": "<p>b</p>" };

async function serve(make: () => MockLanguageModelV4 = () => scripted([{ say: "hi" }])) {
  const made: MockLanguageModelV4[] = [];
  t = await startServe(FILES, CONFIG, {
    ai: {
      keys: { anthropic: "k" },
      createModel: () => {
        const m = make();
        made.push(m);
        return m;
      },
    },
  });
  return { t, made };
}

const ask = (body: unknown, page = "helper") => (t as Served).api(`/api/pages/${page}/ai`, { method: "POST", body });

function streamOf(body: unknown, page = "helper") {
  const ac = new AbortController();
  const served = t as Served;
  const res = fetch(`${served.base}/api/pages/${page}/ai/stream`, {
    method: "POST",
    headers: { cookie: served.cookie, "content-type": "application/json" },
    body: JSON.stringify(body),
    signal: ac.signal,
  });
  return { res, abort: () => ac.abort() };
}

async function sse(res: Response): Promise<{ event: string; data: any }[]> {
  const text = await res.text();
  return text
    .split("\n\n")
    .filter(Boolean)
    .map((chunk) => ({
      event: /^event: (.*)$/m.exec(chunk)?.[1] as string,
      data: JSON.parse(/^data: (.*)$/m.exec(chunk)?.[1] as string),
    }));
}

const apiError = (statusCode: number, opts: { headers?: Record<string, string>; body?: string } = {}) =>
  new APICallError({
    message: `provider said ${statusCode}`,
    url: "https://provider.test/v1",
    requestBodyValues: {},
    statusCode,
    responseHeaders: opts.headers,
    responseBody: opts.body,
    isRetryable: statusCode === 429,
  });

test("a page without ai may not use it", async () => {
  await serve();
  expect(await ask({ prompt: "x" }, "board")).toEqual({ status: 403, body: { error: "page board may not use AI" } });
  expect((await ask({ prompt: "x" }, "nope")).status).toBe(404);
});

test("without an agent the answer is no_key", async () => {
  t = await startServe(FILES, CONFIG, { agent: false });
  expect(await ask({ prompt: "x" })).toMatchObject({ status: 503, body: { code: "no_key" } });
});

test.each([
  [{ prompt: "" }],
  [{ prompt: "   " }],
  [{}],
  [{ prompt: 3 }],
  [{ prompt: [] }],
  [{ prompt: [{ role: "system", content: "x" }] }],
  [{ prompt: [{ role: "user", content: 1 }] }],
  [{ prompt: ["x"] }],
  [{ prompt: "x", schema: "obj" }],
  [{ prompt: "x", schema: [] }],
  [{ prompt: "x", schema: null }],
  [{ prompt: "x", system: 1 }],
  [{ prompt: "x", model: 1 }],
  [{ prompt: "x", model: "not-a-listed-model" }],
  [{ prompt: "x", maxOutputTokens: 0 }],
  [{ prompt: "x", maxOutputTokens: 1.5 }],
  [{ prompt: "x", maxOutputTokens: "10" }],
  ["x"],
])("bad body %j → 400", async (body) => {
  const { made } = await serve();
  const res = await ask(body);
  expect(res.status).toBe(400);
  expect(made.every((m) => m.doGenerateCalls.length === 0)).toBe(true);
});

test("pages cannot send API keys", async () => {
  const { made } = await serve();
  expect(await ask({ prompt: "x", apiKey: "sk" })).toEqual({
    status: 400,
    body: { error: "pages cannot send API keys" },
  });
  expect(made).toHaveLength(0);
});

test("text answers carry the system and the messages", async () => {
  const { made } = await serve(() => scripted([{ say: "hello" }]));
  const res = await ask({
    system: "be brief",
    prompt: [
      { role: "user", content: "hi" },
      { role: "assistant", content: "yes?" },
      { role: "user", content: "again" },
    ],
  });
  expect(res).toEqual({ status: 200, body: { text: "hello" } });
  const sent = JSON.stringify(made[0]?.doGenerateCalls[0]?.prompt);
  expect(sent).toContain("be brief");
  expect(sent).toContain("again");
});

test("a blank system is the same as none", async () => {
  const { made } = await serve(() => scripted([{ say: "a" }, { say: "b" }]));
  for (const system of ["", "  \n"]) {
    expect((await ask({ system, prompt: "hi" })).status).toBe(200);
  }
  for (const m of made) {
    expect((m.doGenerateCalls[0]?.prompt ?? []).some((p) => p.role === "system")).toBe(false);
  }
});

test("a schema gives an object", async () => {
  await serve(() => scripted([{ say: '{"n":2}' }]));
  const res = await ask({
    prompt: "count",
    schema: { type: "object", properties: { n: { type: "number" } }, required: ["n"] },
  });
  expect(res).toEqual({ status: 200, body: { object: { n: 2 } } });
});

test("maxOutputTokens is the smallest of the request and the page's cap", async () => {
  const { made } = await serve();
  await ask({ prompt: "x" });
  await ask({ prompt: "x", maxOutputTokens: 50 });
  await ask({ prompt: "x", maxOutputTokens: 100_000 });
  await ask({ prompt: "x" }, "capped");
  await ask({ prompt: "x", maxOutputTokens: 50 }, "capped");
  await ask({ prompt: "x", maxOutputTokens: 500 }, "capped");
  expect(made.map((m) => m.doGenerateCalls[0]?.maxOutputTokens)).toEqual([1024, 50, 1024, 100, 50, 100]);
});

test("stream: deltas, then done", async () => {
  await serve(() => scripted([{ deltas: ["Hel", "lo"] }]));
  const res = await streamOf({ prompt: "x" }).res;
  expect(res.headers.get("content-type")).toMatch(/^text\/event-stream/);
  expect(await sse(res)).toEqual([
    { event: "delta", data: { text: "Hel" } },
    { event: "delta", data: { text: "lo" } },
    { event: "done", data: {} },
  ]);
});

test("stream refuses a schema", async () => {
  await serve();
  const res = await streamOf({ prompt: "x", schema: {} }).res;
  expect(res.status).toBe(400);
});

test("stream: an error after the head arrives as an error event with its extra fields", async () => {
  await serve(() => scripted([{ deltas: ["a"], fail: apiError(429, { headers: { "retry-after": "7" } }) }]));
  const res = await streamOf({ prompt: "x" }).res;
  expect(res.status).toBe(200);
  const events = await sse(res);
  expect(events[0]).toEqual({ event: "delta", data: { text: "a" } });
  expect(events[1]).toMatchObject({
    event: "error",
    data: { status: 429, provider: "anthropic", retryAfter: 7 },
  });
  expect(typeof events[1]?.data.error).toBe("string");
});

// reasons first, then waits for go() before it writes any text; abort ends it
function thinker() {
  let go = () => {};
  const ready = new Promise<void>((r) => (go = r));
  const model = new MockLanguageModelV4({
    doStream: async ({ abortSignal }) => ({
      stream: new ReadableStream({
        async start(c) {
          abortSignal?.addEventListener("abort", () => c.error(abortSignal.reason));
          c.enqueue({ type: "stream-start", warnings: [] });
          c.enqueue({ type: "reasoning-start", id: "r" });
          c.enqueue({ type: "reasoning-delta", id: "r", delta: "hmm" });
          await ready;
          c.enqueue({ type: "reasoning-end", id: "r" });
          c.enqueue({ type: "text-start", id: "t" });
          c.enqueue({ type: "text-delta", id: "t", delta: "hi" });
          c.enqueue({ type: "text-end", id: "t" });
          c.enqueue({
            type: "finish",
            usage: {
              inputTokens: { total: 1, noCache: 1, cacheRead: undefined, cacheWrite: undefined },
              outputTokens: { total: 1, text: 1, reasoning: undefined },
            },
            finishReason: { unified: "stop", raw: undefined },
          });
          c.close();
        },
      }) as never,
    }),
  });
  return { model, go: () => go() };
}

test("stream: the head arrives while the model is still reasoning", async () => {
  const th = thinker();
  await serve(() => th.model);
  const res = await streamOf({ prompt: "x" }).res;
  expect(res.status).toBe(200);
  th.go();
  expect(await sse(res)).toEqual([
    { event: "delta", data: { text: "hi" } },
    { event: "done", data: {} },
  ]);
});

test("stream: a provider 429 before any text is a plain 429 with retryAfter", async () => {
  await serve(() => scripted([apiError(429, { headers: { "retry-after": "30" } })]));
  const res = await streamOf({ prompt: "x" }).res;
  expect(res.status).toBe(429);
  expect(await res.json()).toMatchObject({ provider: "anthropic", retryAfter: 30 });
});

// never answers until aborted
const silent = () =>
  new MockLanguageModelV4({
    doStream: ({ abortSignal }) =>
      new Promise((_, reject) => abortSignal?.addEventListener("abort", () => reject(abortSignal.reason))),
  });

test("aborting streams before any text gives their slots back", async () => {
  let make: () => MockLanguageModelV4 = silent;
  const { made } = await serve(() => make());
  const open = [1, 2, 3, 4].map(() => streamOf({ prompt: "x" }));
  await waitForAsync(async () => made.length === 4);
  for (const s of open) {
    s.abort();
    await s.res.catch(() => {});
  }
  make = () => scripted([{ say: "ok" }]);
  await waitForAsync(async () => {
    const all = await Promise.all([1, 2, 3, 4].map(() => ask({ prompt: "x" })));
    return all.every((r) => r.status === 200);
  });
});

test("stream: an error before any text is a plain error response", async () => {
  await serve(() => scripted([apiError(401)]));
  const res = await streamOf({ prompt: "x" }).res;
  expect(res.status).toBe(502);
  expect(await res.json()).toMatchObject({ provider: "anthropic" });
});

test("aborting the stream request aborts the model call", async () => {
  const { made } = await serve(() => hanging());
  const s = streamOf({ prompt: "x" });
  const res = await s.res;
  expect(res.status).toBe(200);
  s.abort();
  await waitForAsync(async () => made[0]?.doStreamCalls[0]?.abortSignal?.aborted === true);
});

test("a provider 429 comes back at once with retryAfter", async () => {
  const { made } = await serve(() => scripted([apiError(429, { headers: { "retry-after": "30" } })]));
  const res = await ask({ prompt: "x" });
  expect(res).toMatchObject({ status: 429, body: { provider: "anthropic", retryAfter: 30 } });
  expect(made[0]?.doGenerateCalls).toHaveLength(1);
});

test("other provider failures are 502", async () => {
  await serve(() => scripted([apiError(401)]));
  expect(await ask({ prompt: "x" })).toMatchObject({ status: 502, body: { provider: "anthropic" } });
});

test.each([
  ['{"type":"error","error":{"type":"no_key","message":"no key"}}'],
  ['{"error":{"type":"no_key","code":"no_key","message":"no key"}}'],
])("a proxy's 422 no_key is 503 no_key: %s", async (body) => {
  await serve(() => scripted([apiError(422, { body })]));
  expect(await ask({ prompt: "x" })).toMatchObject({ status: 503, body: { code: "no_key" } });
});

test("a 422 for another reason is 502", async () => {
  await serve(() => scripted([apiError(422, { body: '{"error":{"type":"invalid_request"}}' })]));
  expect((await ask({ prompt: "x" })).status).toBe(502);
});

test("the fifth request at once is refused; slots come back on abort", async () => {
  await serve(() => hanging());
  const open = [1, 2, 3, 4].map(() => streamOf({ prompt: "x" }));
  for (const s of open) expect((await s.res).status).toBe(200);
  expect(await ask({ prompt: "x" })).toMatchObject({
    status: 429,
    body: { error: "too many AI requests at once", retryAfter: 1 },
  });
  for (const s of open) s.abort();
  await waitForAsync(async () => {
    const s = streamOf({ prompt: "x" });
    const ok = (await s.res).status === 200;
    s.abort();
    return ok;
  });
});

test("slots come back after success and after errors", async () => {
  const replies: Reply[] = [];
  for (let i = 0; i < 5; i++) replies.push({ say: "ok" }, apiError(500), { deltas: ["a"], fail: new Error("x") });
  let n = 0;
  await serve(() => scripted([replies[n++] as Reply]));
  for (let i = 0; i < 5; i++) {
    expect((await ask({ prompt: "x" })).status).toBe(200);
    expect((await ask({ prompt: "x" })).status).toBe(502);
    expect(await sse(await streamOf({ prompt: "x" }).res)).toMatchObject([{ event: "delta" }, { event: "error" }]);
  }
  expect((await ask({ prompt: "x" })).status).toBe(200);
});
