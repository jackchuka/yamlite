import { afterEach, expect, test, vi } from "vitest";
import { pageSdk } from "./sdk";

function fake(theme?: "light" | "dark") {
  const sent: Array<Record<string, unknown>> = [];
  let onMessage: (e: { source: unknown; data: unknown }) => void = () => {};
  let onViolation: (e: { blockedURI: string }) => void = () => {};
  const parent = { postMessage: (m: Record<string, unknown>) => sent.push(m) };
  const root = { dataset: {} as Record<string, string> };
  const win = {
    parent,
    setInterval: (fn: () => void, ms: number) => setInterval(fn, ms),
    clearInterval: (h: ReturnType<typeof setInterval>) => clearInterval(h),
    addEventListener: (_t: string, fn: typeof onMessage) => (onMessage = fn),
    document: { addEventListener: (_t: string, fn: typeof onViolation) => (onViolation = fn), documentElement: root },
  } as Record<string, any>;
  pageSdk(win as never, theme);
  return {
    yamlite: win.yamlite,
    sent,
    root,
    reply: (data: unknown) => onMessage({ source: parent, data }),
    fromOther: (data: unknown) => onMessage({ source: {}, data }),
    violate: (url: string) => onViolation({ blockedURI: url }),
  };
}

afterEach(() => vi.useRealTimers());

test("hello is re-posted until the parent answers, then no more", async () => {
  vi.useFakeTimers();
  const f = fake();
  const hellos = () => f.sent.filter((m) => m.method === "hello");
  expect(hellos()).toHaveLength(1);
  vi.advanceTimersByTime(250);
  expect(hellos()).toHaveLength(3);
  expect(hellos().every((m) => m.id === 1)).toBe(true);
  f.reply({ yamlite: 1, id: 1, ok: true, value: { page: "board", readOnly: false } });
  await f.yamlite.ready;
  vi.advanceTimersByTime(1000);
  expect(hellos()).toHaveLength(3);
});

test("ready asks the parent who the page is", async () => {
  const f = fake();
  expect(f.sent[0]).toEqual({ yamlite: 1, id: 1, method: "hello", args: [] });
  f.reply({ yamlite: 1, id: 1, ok: true, value: { page: "board", readOnly: false } });
  await expect(f.yamlite.ready).resolves.toEqual({ page: "board", readOnly: false });
});

test("a call posts a request and resolves with the parent's answer", async () => {
  const f = fake();
  const p = f.yamlite.rows("tasks", { limit: 5 });
  expect(f.sent.at(-1)).toEqual({ yamlite: 1, id: 2, method: "rows", args: ["tasks", { limit: 5 }] });
  f.reply({ yamlite: 1, id: 2, ok: true, value: { rows: [], total: 0 } });
  await expect(p).resolves.toEqual({ rows: [], total: 0 });
});

test("an error answer rejects with a YamliteError carrying status and extra", async () => {
  const f = fake();
  const p = f.yamlite.update("tasks", "a", { status: "done" }, { status: "todo" });
  f.reply({ yamlite: 1, id: 2, ok: false, error: { status: 409, message: "changed", extra: { stale: ["status"] } } });
  const err = await p.catch((e: unknown) => e);
  expect(err).toBeInstanceOf(f.yamlite.YamliteError);
  expect(err).toMatchObject({ status: 409, message: "changed", extra: { stale: ["status"] } });
});

test("answers that arrive out of order resolve their own calls", async () => {
  const f = fake();
  const a = f.yamlite.get("tasks", "a");
  const b = f.yamlite.get("tasks", "b");
  f.reply({ yamlite: 1, id: 3, ok: true, value: "B" });
  f.reply({ yamlite: 1, id: 2, ok: true, value: "A" });
  await expect(Promise.all([a, b])).resolves.toEqual(["A", "B"]);
});

test("messages from other windows and foreign shapes are ignored", async () => {
  const f = fake();
  const p = f.yamlite.sql("select 1");
  f.fromOther({ yamlite: 1, id: 2, ok: true, value: "forged" });
  f.reply({ id: 2, ok: true, value: "no marker" });
  f.reply({ yamlite: 1, id: 2, ok: true, value: "real" });
  await expect(p).resolves.toBe("real");
});

test("change events reach subscribers until they unsubscribe", () => {
  const f = fake();
  const got: unknown[] = [];
  const off = f.yamlite.on("change", (d: unknown) => got.push(d));
  f.reply({ yamlite: 1, event: "change", data: { tables: ["tasks"] } });
  off();
  f.reply({ yamlite: 1, event: "change", data: { tables: ["people"] } });
  expect(got).toEqual([{ tables: ["tasks"] }]);
  expect(() => f.yamlite.on("other", () => {})).toThrow('only "change" and "theme" can be subscribed to');
});

test("a blocked request is reported to the parent", () => {
  const f = fake();
  f.violate("https://example.com/x");
  expect(f.sent.at(-1)).toEqual({ yamlite: 1, method: "blocked", args: ["https://example.com/x"] });
});

test("the SDK can be inlined in a script tag", () => {
  expect(String(pageSdk)).not.toMatch(/<\/script/i);
});

test("the initial theme is on the root and readable", () => {
  const f = fake("dark");
  expect(f.root.dataset.theme).toBe("dark");
  expect(f.yamlite.theme).toBe("dark");
  expect(fake().yamlite.theme).toBe("light");
});

test("a theme event from the parent switches the root and tells subscribers", () => {
  const f = fake("light");
  const seen: string[] = [];
  f.yamlite.on("theme", (d: { theme: string }) => seen.push(d.theme));
  f.root.dataset.theme = "light-custom";
  f.reply({ yamlite: 1, event: "theme", data: { theme: "dark" } });
  expect(f.root.dataset.theme).toBe("dark");
  expect(f.yamlite.theme).toBe("dark");
  expect(seen).toEqual(["dark"]);
  f.fromOther({ yamlite: 1, event: "theme", data: { theme: "light" } });
  expect(f.yamlite.theme).toBe("dark");
});

test("a theme event that changes nothing is a no-op, and an invalid one is ignored", () => {
  const f = fake("dark");
  const seen: string[] = [];
  f.yamlite.on("theme", (d: { theme: string }) => seen.push(d.theme));
  f.root.dataset.theme = "mine";
  f.reply({ yamlite: 1, event: "theme", data: { theme: "dark" } });
  expect(f.root.dataset.theme).toBe("mine");
  expect(seen).toEqual([]);
  f.reply({ yamlite: 1, event: "theme", data: { theme: "blue" } });
  f.reply({ yamlite: 1, event: "theme" });
  expect(f.root.dataset.theme).toBe("mine");
  expect(f.yamlite.theme).toBe("dark");
  expect(seen).toEqual([]);
});

test("only change and theme can be subscribed to", () => {
  expect(() => fake().yamlite.on("other", () => {})).toThrow('only "change" and "theme" can be subscribed to');
});
