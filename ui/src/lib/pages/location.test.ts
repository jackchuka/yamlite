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

function fakeWindow(hash = "") {
  const listeners = new Map<string, Set<() => void>>();
  const calls: string[] = [];
  const win = {
    location: { pathname: "/-/apps/board/", search: "?token=t", hash },
    history: {
      pushState: (_s: unknown, _u: string, url: string) => {
        calls.push(`push ${url}`);
        win.location.hash = url.includes("#") ? url.slice(url.indexOf("#")) : "";
      },
      replaceState: (_s: unknown, _u: string, url: string) => {
        calls.push(`replace ${url}`);
        win.location.hash = url.includes("#") ? url.slice(url.indexOf("#")) : "";
      },
      go: (delta: number) => calls.push(`go ${delta}`),
    },
    addEventListener: (t: string, fn: () => void) => listeners.set(t, (listeners.get(t) ?? new Set()).add(fn)),
    removeEventListener: (t: string, fn: () => void) => listeners.get(t)?.delete(fn),
    fire: (t: string) => listeners.get(t)?.forEach((fn) => fn()),
  };
  return { win, calls };
}

test("an app reads its place from the address and writes it after the #", () => {
  const { win, calls } = fakeWindow("#/orders/42");
  const place = hashLocation(win);
  expect(place.path).toBe("/orders/42");
  place.navigate("/orders/43", false);
  place.navigate("/", true);
  place.go(-1);
  expect(calls).toEqual(["push /-/apps/board/?token=t#/orders/43", "replace /-/apps/board/?token=t", "go -1"]);
});

test("an address with no # or a typed one the parser would change opens at its clean form", () => {
  expect(hashLocation(fakeWindow().win).path).toBe("/");
  expect(hashLocation(fakeWindow("#/a b").win).path).toBe("/a%20b");
  expect(hashLocation(fakeWindow("#/a%20b").win).path).toBe("/a%20b");
});

test("back, forward and a typed address are heard once, and not after the listener is gone", () => {
  const { win } = fakeWindow("#/a");
  const place = hashLocation(win);
  const heard: string[] = [];
  const off = place.listen((p) => heard.push(p));
  win.location.hash = "#/b";
  win.fire("popstate");
  win.fire("hashchange");
  place.navigate("/c", false);
  win.fire("popstate");
  off();
  win.location.hash = "#/d";
  win.fire("popstate");
  expect(heard).toEqual(["/b"]);
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
