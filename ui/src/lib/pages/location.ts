// where a page stands inside itself, set through yamlite.history. An app keeps it after the # of its address, so a
// reload, the back button and a shared link reach the same place; in the editor it lasts as long as the page is open

const MAX = 2048;
const BASE = "http://page";

// as the URL parser writes it, so what the page set and what the address reads back are the same text
export function pagePath(to: unknown, from = "/"): string | null {
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

export interface PageLocation {
  readonly path: string;
  navigate(path: string, replace: boolean): void;
  go(delta: number): void;
  // called when the place changes other than by navigate: the back and forward buttons, or a typed address
  listen(fn: (path: string) => void): () => void;
}

interface LocationWindow {
  location: { pathname: string; search: string; hash: string };
  history: {
    pushState(state: unknown, unused: string, url: string): void;
    replaceState(state: unknown, unused: string, url: string): void;
    go(delta: number): void;
  };
  addEventListener(type: "popstate" | "hashchange", fn: () => void): void;
  removeEventListener(type: "popstate" | "hashchange", fn: () => void): void;
}

// "#/orders/42"; the page's top leaves the address without a #
export function hashLocation(win: LocationWindow): PageLocation {
  const read = () => pagePath(decodeHash(win.location.hash.slice(1)) || "/") ?? "/";
  let path = read();
  return {
    get path() {
      return path;
    },
    navigate(to, replace) {
      path = to;
      const { pathname, search } = win.location;
      const url = to === "/" ? pathname + search : `${pathname}${search}#${to}`;
      if (replace) win.history.replaceState(null, "", url);
      else win.history.pushState(null, "", url);
    },
    go: (delta) => win.history.go(delta),
    listen(fn) {
      // going back across a # fires both events
      const changed = () => {
        const now = read();
        if (now === path) return;
        path = now;
        fn(now);
      };
      win.addEventListener("popstate", changed);
      win.addEventListener("hashchange", changed);
      return () => {
        win.removeEventListener("popstate", changed);
        win.removeEventListener("hashchange", changed);
      };
    },
  };
}

// a typed address may hold characters the parser would encode again
function decodeHash(hash: string): string {
  try {
    return decodeURI(hash);
  } catch {
    return hash;
  }
}

export function memoryLocation(): PageLocation {
  const entries = ["/"];
  let index = 0;
  const listeners = new Set<(path: string) => void>();
  return {
    get path() {
      return entries[index] as string;
    },
    navigate(to, replace) {
      if (replace) entries[index] = to;
      else {
        entries.length = index + 1;
        entries.push(to);
        index += 1;
      }
    },
    go(delta) {
      const next = Math.min(Math.max(index + delta, 0), entries.length - 1);
      if (next === index) return;
      index = next;
      for (const fn of listeners) fn(entries[index] as string);
    },
    listen(fn) {
      listeners.add(fn);
      return () => listeners.delete(fn);
    },
  };
}
