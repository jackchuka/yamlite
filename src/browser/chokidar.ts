import { resolve } from "pathe";
import { type FsEvent, onChange } from "./fs.ts";

// oxlint-disable-next-line typescript/no-explicit-any
type Listener = (...args: any[]) => void;

export interface FSWatcher {
  on(event: string, fn: Listener): FSWatcher;
  once(event: string, fn: Listener): FSWatcher;
  add(paths: string | string[]): FSWatcher;
  unwatch(paths: string | string[]): FSWatcher;
  close(): Promise<void>;
}

interface Options {
  depth?: number;
  ignored?: (path: string) => boolean;
  ignoreInitial?: boolean;
}

const list = (paths: string | string[]) => (Array.isArray(paths) ? paths : [paths]).map((p) => resolve(p));

// the path segments below root, or null when path is not under it
const below = (root: string, path: string): string[] | null => {
  if (path === root) return [];
  const prefix = root === "/" ? "/" : `${root}/`;
  return path.startsWith(prefix) ? path.slice(prefix.length).split("/") : null;
};

// chokidar's watch over the in-memory fs; only what yamlite's watch and page watch use
export function watch(paths: string | string[], opts: Options = {}): FSWatcher {
  const roots = new Set(list(paths));
  const listeners = new Map<string, Set<Listener>>();
  let closed = false;
  const fire = (event: string, ...args: unknown[]) => {
    for (const fn of Array.from(listeners.get(event) ?? [])) fn(...args);
  };
  const wanted = (path: string): boolean =>
    [...roots].some((root) => {
      const parts = below(root, path);
      if (!parts) return false;
      if (opts.depth !== undefined && parts.length > 0 && parts.length - 1 > opts.depth) return false;
      let at = root;
      return !parts.some((part) => {
        at = at === "/" ? `/${part}` : `${at}/${part}`;
        return opts.ignored?.(at);
      });
    });
  const off = onChange((event: FsEvent, path: string) => {
    if (closed || !wanted(path)) return;
    fire(event, path);
    fire("all", event, path);
  });
  const w: FSWatcher = {
    on(event, fn) {
      const set = listeners.get(event) ?? new Set();
      set.add(fn);
      listeners.set(event, set);
      return w;
    },
    once(event, fn) {
      const wrapped: Listener = (...args) => {
        listeners.get(event)?.delete(wrapped);
        fn(...args);
      };
      return w.on(event, wrapped);
    },
    add(p) {
      for (const x of list(p)) roots.add(x);
      return w;
    },
    unwatch(p) {
      for (const x of list(p)) roots.delete(x);
      return w;
    },
    async close() {
      closed = true;
      off();
      listeners.clear();
    },
  };
  queueMicrotask(() => !closed && fire("ready"));
  return w;
}
