import { expect, test, vi } from "vitest";
import { ApiError, request, session } from "./api";

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
