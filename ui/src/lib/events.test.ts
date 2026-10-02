import { expect, test, vi } from "vitest";
import { session } from "./api";
import { EventStore } from "./events";

function fakeSource() {
  const handlers = new Map<string, (e: Event) => void>();
  const source = {
    addEventListener: (type: string, fn: (e: Event) => void) => handlers.set(type, fn),
    close: vi.fn(),
    onerror: null as unknown,
    readyState: 0,
  };
  return { source: source as unknown as EventSource, handlers, raw: source };
}

test("a data-less connection error does not break the store", () => {
  const { source, handlers } = fakeSource();
  const store = new EventStore();
  store.connect("/x", () => source);
  const listener = vi.fn();
  store.listen(listener);
  expect(() => handlers.get("error")?.(new Event("error"))).not.toThrow();
  expect(() => handlers.get("error")?.(new MessageEvent("error", { data: "{not json" }))).not.toThrow();
  expect(listener).not.toHaveBeenCalled();
});

test("a server error event still reaches apply", () => {
  const { source, handlers } = fakeSource();
  const store = new EventStore();
  store.connect("/x", () => source);
  const listener = vi.fn();
  store.listen(listener);
  const ev = { type: "error", at: "t", message: "boom" };
  handlers.get("error")?.(new MessageEvent("error", { data: JSON.stringify(ev) }));
  expect(listener).toHaveBeenCalledWith(ev);
  expect(store.getSnapshot().activity).toEqual([ev]);
});

test("a stream that closed for good probes the API so a 401 shows the expired session", async () => {
  const { source, raw } = fakeSource();
  const fetcher = vi.fn(async () => new Response('{"error":"nope"}', { status: 401 }));
  vi.stubGlobal("fetch", fetcher);
  try {
    const store = new EventStore();
    store.connect("/x", () => source);
    raw.readyState = 0; // still reconnecting: no probe
    (raw.onerror as () => void)();
    expect(fetcher).not.toHaveBeenCalled();
    raw.readyState = 2;
    (raw.onerror as () => void)();
    await vi.waitFor(() => expect(session.expired()).toBe(true));
    expect(fetcher).toHaveBeenCalledWith("/api/meta", expect.anything());
  } finally {
    vi.unstubAllGlobals();
  }
});
