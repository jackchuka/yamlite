// where a page stands inside itself, set through yamlite.history. An app keeps it after the # of its address, so a
// reload, the back button and a shared link reach the same place; in the editor it lasts as long as the page is open

// as the URL parser writes it, so what the page set and what the address reads back are the same text. The page's SDK
// runs this from its source text, so it must not use anything from outside its body
export function pagePath(to: unknown, from = "/"): string | null {
  const MAX = 2048;
  const BASE = "http://page";
  if (typeof to !== "string" || to.length > MAX) return null;
  try {
    const u = new URL(to, new URL(from, BASE));
    if (u.origin !== BASE) return null;
    const path = u.pathname + u.search + u.hash;
    return path.length > MAX ? null : path;
  } catch {
    return null;
  }
}

// state is what the page moved with: structured-cloneable, it comes back when the page returns to that place
export interface PageLocation {
  readonly path: string;
  readonly state: unknown;
  navigate(path: string, replace: boolean, state?: unknown): void;
  go(delta: number): void;
  // called when the place changes other than by navigate: the back and forward buttons, or a typed address
  listen(fn: (path: string, state: unknown) => void): () => void;
  // stops following the address, when the page closes
  dispose(): void;
}

interface LocationWindow {
  location: { pathname: string; search: string; hash: string };
  history: {
    readonly state: unknown;
    pushState(state: unknown, unused: string, url: string): void;
    replaceState(state: unknown, unused: string, url: string): void;
    go(delta: number): void;
  };
  addEventListener(type: "popstate" | "hashchange", fn: () => void): void;
  removeEventListener(type: "popstate" | "hashchange", fn: () => void): void;
}

// yamlite's own key in an entry's state; the rest of it is the embedding host's, and kept
const KEY = "yamlite";
type Entry = { index: number; state: unknown };

// "#/orders/42"; the page's top leaves the address without a #, and a # that is not a path stands for the top
export function hashLocation(win: LocationWindow): PageLocation {
  // as written: the path went in already as the parser writes it, so decoding would change what the page set
  const read = () => (win.location.hash.startsWith("#/") ? (pagePath(win.location.hash.slice(1)) ?? "/") : "/");
  const others = () => {
    const s = win.history.state;
    return typeof s === "object" && s !== null ? (s as Record<string, unknown>) : {};
  };
  const entry = (): Entry | undefined => {
    const e = others()[KEY] as Entry | undefined;
    return typeof e?.index === "number" ? e : undefined;
  };
  const write = (replace: boolean, url: string, e: Entry) => {
    const state = { ...others(), [KEY]: e };
    if (replace) win.history.replaceState(state, "", url);
    else win.history.pushState(state, "", url);
  };
  const app = () => win.location.pathname + win.location.search;
  const here = () => app() + win.location.hash;
  // the entry the app opened on is its first: back never goes before it
  if (entry() === undefined) write(true, here(), { index: 0, state: null });
  let { index, state } = entry() as Entry;
  let path = read();
  const home = app();
  const listeners = new Set<(path: string, state: unknown) => void>();
  // kept up to date whether or not a frame listens, so a new one starts where the address is
  const changed = () => {
    if (app() !== home) return;
    // a typed address or a link to a # is a new entry after the one the app was at
    if (entry() === undefined) write(true, here(), { index: index + 1, state: null });
    const now = read();
    const at = entry() as Entry;
    // going back across a # fires both events
    if (at.index === index && now === path) return;
    ({ index, state } = at);
    path = now;
    for (const fn of listeners) fn(path, state);
  };
  win.addEventListener("popstate", changed);
  win.addEventListener("hashchange", changed);
  return {
    get path() {
      return path;
    },
    get state() {
      return state;
    },
    navigate(to, replace, next = null) {
      const { pathname, search } = win.location;
      write(replace, to === "/" ? pathname + search : `${pathname}${search}#${to}`, {
        index: replace ? index : index + 1,
        state: next,
      });
      if (!replace) index += 1;
      path = to;
      state = next;
    },
    go(delta) {
      const to = Math.max(delta, -index);
      if (to !== 0) win.history.go(to);
    },
    listen(fn) {
      listeners.add(fn);
      return () => listeners.delete(fn);
    },
    dispose() {
      win.removeEventListener("popstate", changed);
      win.removeEventListener("hashchange", changed);
      listeners.clear();
    },
  };
}

export function memoryLocation(): PageLocation {
  const entries: Array<{ path: string; state: unknown }> = [{ path: "/", state: null }];
  let index = 0;
  const listeners = new Set<(path: string, state: unknown) => void>();
  const current = () => entries[index] as { path: string; state: unknown };
  return {
    get path() {
      return current().path;
    },
    get state() {
      return current().state;
    },
    navigate(path, replace, state = null) {
      if (replace) entries[index] = { path, state };
      else {
        entries.length = index + 1;
        entries.push({ path, state });
        index += 1;
      }
    },
    go(delta) {
      const next = Math.min(Math.max(index + delta, 0), entries.length - 1);
      if (next === index) return;
      index = next;
      for (const fn of listeners) fn(current().path, current().state);
    },
    listen(fn) {
      listeners.add(fn);
      return () => listeners.delete(fn);
    },
    dispose() {
      listeners.clear();
    },
  };
}
