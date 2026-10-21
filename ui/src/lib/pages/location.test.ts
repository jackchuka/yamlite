import { expect, test } from "vitest";
import { hashLocation, memoryLocation, pagePath } from "./location";

test("a path is read as the URL parser writes it, relative to where the page is", () => {
  expect(pagePath("/orders/42?tab=1#note")).toBe("/orders/42?tab=1#note");
  expect(pagePath("/a b")).toBe("/a%20b");
  expect(pagePath("42", "/orders/7")).toBe("/orders/42");
  expect(pagePath("?tab=2", "/orders/7")).toBe("/orders/7?tab=2");
});

test("a path that leaves the page, or is not one, is refused", () => {
  for (const to of ["https://example.com/x", "//example.com/x", "javascript:alert(1)", 42, null, "/x".repeat(2000)])
    expect(pagePath(to)).toBeNull();
});

test("the rules stand alone, so the page's SDK runs the same ones from their source", () => {
  const alone = new Function(`return (${pagePath})`)() as typeof pagePath;
  for (const [to, from] of [["/a b"], ["42", "/orders/7?x=1"], ["//example.com/x"], ["/x".repeat(1100)]])
    expect(alone(to, from)).toBe(pagePath(to, from));
});

// a session history: the entries before the app's are the embedding host's, with state its router keeps
function fakeWindow(hash = "", before: Array<{ hash: string; state: unknown }> = []) {
  const listeners = new Map<string, Set<() => void>>();
  const calls: string[] = [];
  const entries = [...before, { hash, state: before.length > 0 ? { router: "r" } : (null as unknown) }];
  let index = entries.length - 1;
  const fire = (t: string) => listeners.get(t)?.forEach((fn) => fn());
  const write = (replace: boolean) => (state: unknown, _u: string, url: string) => {
    calls.push(`${replace ? "replace" : "push"} ${url}`);
    const entry = { hash: url.includes("#") ? url.slice(url.indexOf("#")) : "", state: structuredClone(state) };
    if (replace) entries[index] = entry;
    else {
      entries.length = index + 1;
      entries.push(entry);
      index += 1;
    }
  };
  const move = (to: number) => {
    const was = entries[index]?.hash;
    index = to;
    fire("popstate");
    if (entries[index]?.hash !== was) fire("hashchange");
  };
  const win = {
    location: {
      pathname: "/-/apps/board/",
      search: "?token=t",
      get hash() {
        return entries[index]?.hash ?? "";
      },
    },
    history: {
      get state() {
        return entries[index]?.state;
      },
      pushState: write(false),
      replaceState: write(true),
      go: (delta: number) => {
        calls.push(`go ${delta}`);
        if (delta === 0) calls.push("reload");
        else if (entries[index + delta]) move(index + delta);
      },
    },
    addEventListener: (t: string, fn: () => void) => listeners.set(t, (listeners.get(t) ?? new Set()).add(fn)),
    removeEventListener: (t: string, fn: () => void) => listeners.get(t)?.delete(fn),
    // the user typing an address, or a link to a #: a new entry with no state
    type: (hash: string) => {
      entries.length = index + 1;
      entries.push({ hash, state: null });
      move(index + 1);
    },
    back: () => move(index - 1),
  };
  return { win, calls, entries, at: () => index };
}

test("an app reads its place from the address and writes it after the #", () => {
  const { win, calls } = fakeWindow("#/orders/42");
  const place = hashLocation(win);
  expect(place.path).toBe("/orders/42");
  calls.length = 0;
  place.navigate("/orders/43", false);
  place.navigate("/", true);
  place.go(-1);
  expect(calls).toEqual(["push /-/apps/board/?token=t#/orders/43", "replace /-/apps/board/?token=t", "go -1"]);
  expect(place.path).toBe("/orders/42");
});

test("a closed app stops following the address", () => {
  const { win, calls } = fakeWindow("#/a");
  const place = hashLocation(win);
  const heard: string[] = [];
  place.listen((path) => heard.push(path));
  place.dispose();
  calls.length = 0;
  win.type("#/b");
  expect(heard).toEqual([]);
  expect(calls).toEqual([]);
});

test("an address with no # or a typed one the parser would change opens at its clean form", () => {
  expect(hashLocation(fakeWindow().win).path).toBe("/");
  expect(hashLocation(fakeWindow("#/a b").win).path).toBe("/a%20b");
  expect(hashLocation(fakeWindow("#/a%20b").win).path).toBe("/a%20b");
});

test("a path the page set comes back from the address unchanged, escapes and all", () => {
  for (const to of ["/items/100%25", "/a%5Bb%5D", "/%41", "/q?x=%26&y=%2F#%23", "/caf%C3%A9"]) {
    const { win } = fakeWindow();
    hashLocation(win).navigate(to, false);
    expect(hashLocation(win).path).toBe(to);
  }
});

test("only a # that starts with / is a place in the page; any other opens the page's start", () => {
  for (const hash of ["#notes", "#", "#?x=1", "#//example.com/x"])
    expect(hashLocation(fakeWindow(hash).win).path).toBe("/");
});

test("back, forward and a typed address are heard once, and not after the listener is gone", () => {
  const { win } = fakeWindow("#/a");
  const place = hashLocation(win);
  const heard: string[] = [];
  const off = place.listen((p) => heard.push(p));
  win.type("#/b");
  place.navigate("/c", false);
  win.back();
  off();
  win.back();
  expect(heard).toEqual(["/b", "/b"]);
});

test("go never leaves the app's own entries, and go(0) stays put", () => {
  const { win, calls, at } = fakeWindow("#/a", [{ hash: "#/p/elsewhere", state: { router: "q" } }]);
  const place = hashLocation(win);
  place.navigate("/b", false);
  place.navigate("/c", false);
  calls.length = 0;
  place.go(0);
  place.go(-5);
  expect(place.path).toBe("/a");
  place.go(-1);
  expect(calls).toEqual(["go -2"]);
  expect(at()).toBe(1);
  place.go(2);
  expect(place.path).toBe("/c");
});

test("the app's entries are its own after a reload, and a typed address while nothing listens is one of them", () => {
  const { win, calls } = fakeWindow("#/a", [{ hash: "", state: null }]);
  hashLocation(win).navigate("/b", false);
  const place = hashLocation(win);
  win.type("#/c");
  calls.length = 0;
  place.go(-9);
  expect(calls).toEqual(["go -2"]);
  expect(place.path).toBe("/a");
});

test("the host's own state in an entry is kept beside the app's", () => {
  const { win, entries } = fakeWindow("#/a", [{ hash: "", state: null }]);
  const place = hashLocation(win);
  place.navigate("/b", false);
  place.navigate("/c", true);
  expect(entries.slice(1).map((e) => (e.state as { router: string }).router)).toEqual(["r", "r"]);
});

test("an entry of the host's own, away from the app, is left as the host keeps it", () => {
  const { win, entries } = fakeWindow("#/a", [{ hash: "", state: { router: "q" } }]);
  const place = hashLocation(win);
  const heard: string[] = [];
  place.listen((p) => heard.push(p));
  win.location.pathname = "/elsewhere";
  win.back();
  expect(entries[0]?.state).toEqual({ router: "q" });
  expect(heard).toEqual([]);
});

test("a move made while no frame listens is the place a new frame starts at", () => {
  const { win } = fakeWindow("#/a");
  const place = hashLocation(win);
  const off = place.listen(() => {});
  place.navigate("/b", false);
  off();
  win.back();
  expect(place.path).toBe("/a");
  const heard: string[] = [];
  place.listen((p) => heard.push(p));
  win.type("#/a?x");
  expect(heard).toEqual(["/a?x"]);
});

test("an app keeps the state the page moved with in the entry, so back, forward and a reload bring it again", () => {
  const { win, entries } = fakeWindow("#/a", [{ hash: "", state: null }]);
  const place = hashLocation(win);
  const heard: unknown[] = [];
  place.listen((p, state) => heard.push([p, state]));
  place.navigate("/b", false, { from: "list", at: new Date(0) });
  place.navigate("/c", false);
  expect(place.state).toBeNull();
  place.go(-1);
  expect(place.state).toEqual({ from: "list", at: new Date(0) });
  expect(entries[2]?.state).toMatchObject({ router: "r" });
  place.go(-1);
  place.go(1);
  expect(heard).toEqual([
    ["/b", { from: "list", at: new Date(0) }],
    ["/a", null],
    ["/b", { from: "list", at: new Date(0) }],
  ]);
  expect(hashLocation(win).state).toEqual({ from: "list", at: new Date(0) });
});

test("in the editor the state the page moved with is kept with its place", () => {
  const place = memoryLocation();
  const heard: unknown[] = [];
  place.listen((p, state) => heard.push([p, state]));
  place.navigate("/a", false, { n: 1 });
  place.navigate("/b", false);
  place.go(-1);
  expect(place.state).toEqual({ n: 1 });
  place.navigate("/c", true, { n: 2 });
  place.go(-1);
  place.go(1);
  expect(heard).toEqual([
    ["/a", { n: 1 }],
    ["/", null],
    ["/c", { n: 2 }],
  ]);
});

test("in the editor the place lives in memory, and go stays within what was visited", () => {
  const place = memoryLocation();
  const heard: string[] = [];
  place.listen((p) => heard.push(p));
  place.navigate("/a", false);
  place.navigate("/b", false);
  place.navigate("/c", true);
  place.go(-1);
  place.go(-5);
  place.go(1);
  place.navigate("/d", false);
  place.go(1);
  expect(heard).toEqual(["/a", "/", "/a"]);
  expect(place.path).toBe("/d");
  place.go(-1);
  expect(place.path).toBe("/a");
});
