import { existsSync } from "node:fs";
import { basename, dirname, resolve } from "node:path";
import { watch as chokidarWatch, type FSWatcher } from "chokidar";
import { type ConflictInfo, type EngineContext, syncTable, type TableResult } from "./engine.ts";
import { checkReferences, referrersOf } from "./references.ts";
import type { TableSpec } from "./types.ts";

export interface WatchHandlers {
  onSync?: (result: TableResult) => void;
  onConflict?: (conflict: ConflictInfo) => void;
  onError?: (error: Error, table?: string) => void;
  onReload?: (tables: string[]) => void;
}

export interface WatchOptions {
  pollMs?: number;
  debounceMs?: number;
}

// root mode: watch the root for yamlite.yaml edits and tables appearing or disappearing
export interface ConfigSource {
  root: string;
  reload: () => readonly TableSpec[];
}

const CONFIG_FILES = new Set(["yamlite.yaml", "yamlite.yml"]);
const TABLE_ENTRY = /\.ya?ml$/i;
const RELOAD_TIMER = "\0config";

export interface Watcher {
  readonly ready: Promise<void>;
  close(): Promise<void>;
}

const asError = (e: unknown): Error => (e instanceof Error ? e : new Error(String(e)));

// chokidar reports ready before the OS watcher (FSEvents on macOS) delivers events;
// changes in that gap are never reported, so wait it out and then sync to catch them.
const SETTLE_MS = 100;

export function startWatch(
  ctx: EngineContext,
  tables: readonly TableSpec[],
  handlers: WatchHandlers,
  options: WatchOptions = {},
  config?: ConfigSource,
): Watcher {
  const pollMs = options.pollMs ?? 300;
  const debounceMs = options.debounceMs ?? 200;
  const timers = new Map<string, NodeJS.Timeout>();
  const running = new Map<string, Promise<void>>();
  const watched = new Set<string>();
  let lastDbChange: number | undefined;
  let closed = false;
  let current = new Map(tables.map((t) => [t.name, t]));
  const all = () => [...current.values()];
  const root = config ? resolve(config.root) : undefined;

  const watchDir = (t: TableSpec) => resolve(t.mode === "dir" ? t.path : dirname(t.path));
  const initialDirs = [...new Set([...tables.map(watchDir), ...(root ? [root] : [])])].filter((dir) => existsSync(dir));
  for (const dir of initialDirs) watched.add(dir);

  const fsWatchers: FSWatcher[] = [];
  const onFsEvent = (event: string, path: string) => {
    const p = resolve(path);
    if (root && dirname(p) === root) {
      const name = basename(p);
      const entry =
        event === "addDir" ||
        event === "unlinkDir" ||
        ((event === "add" || event === "unlink") && TABLE_ENTRY.test(name));
      if (CONFIG_FILES.has(name) || entry) scheduleReload();
    }
    for (const t of all()) {
      if (t.mode === "dir" ? dirname(p) === resolve(t.path) : p === resolve(t.path)) schedule(t.name);
    }
  };
  function startFs(dirs: string[]): Promise<void> {
    const w = chokidarWatch(dirs, {
      ignoreInitial: true,
      depth: 0,
      awaitWriteFinish: { stabilityThreshold: 100, pollInterval: 25 },
      ignored: (path: string) => basename(path).startsWith(".") && !watched.has(resolve(path)),
    });
    fsWatchers.push(w);
    w.on("all", onFsEvent);
    w.on("error", (e) => handlers.onError?.(asError(e)));
    return new Promise<void>((r) => w.once("ready", () => setTimeout(r, SETTLE_MS)));
  }

  const fsReady = initialDirs.length > 0 ? startFs(initialDirs) : Promise.resolve();

  // A directory that appears later is scanned asynchronously; edits made before the
  // scan finishes are invisible to it, so catch up once it is ready.
  function ensureWatched(): void {
    for (const t of all()) {
      const dir = watchDir(t);
      if (!watched.has(dir) && existsSync(dir)) {
        watched.add(dir);
        void startFs([dir]).then(() => {
          for (const u of all()) if (watchDir(u) === dir) schedule(u.name);
        });
      }
    }
  }

  function run(name: string): Promise<void> {
    const next = (running.get(name) ?? Promise.resolve())
      .then(() => {
        const table = current.get(name);
        if (closed || !table) return;
        const result = syncTable(ctx, table, { dbTime: lastDbChange });
        if (result.busy) {
          schedule(name);
          return;
        }
        if (result.ok) result.warnings.push(...checkReferences(ctx.store, table, all()));
        // only a real change re-checks the tables pointing here, so mutual references cannot ping-pong
        if (result.changes.length > 0 || result.schema.length > 0) {
          for (const referrer of referrersOf(name, all())) schedule(referrer.name);
        }
        for (const c of result.conflicts) handlers.onConflict?.(c);
        if (!result.ok) handlers.onError?.(new Error(result.error), name);
        handlers.onSync?.(result);
        ensureWatched();
      })
      .catch((e: unknown) => handlers.onError?.(asError(e), name));
    running.set(name, next);
    return next;
  }

  function later(id: string, fn: () => void): void {
    if (closed) return;
    clearTimeout(timers.get(id));
    timers.set(
      id,
      setTimeout(() => {
        timers.delete(id);
        fn();
      }, debounceMs),
    );
  }

  function schedule(name: string): void {
    later(name, () => void run(name));
  }

  function scheduleReload(): void {
    later(RELOAD_TIMER, () => {
      if (!config || closed) return;
      try {
        current = new Map(config.reload().map((t) => [t.name, t]));
      } catch (e) {
        handlers.onError?.(new Error(`${asError(e).message}; keeping the previous configuration`));
        return;
      }
      handlers.onReload?.([...current.keys()]);
      ensureWatched();
      for (const name of current.keys()) schedule(name);
    });
  }

  let version = ctx.store.dataVersion();
  const poll = setInterval(() => {
    ensureWatched();
    try {
      const v = ctx.store.dataVersion();
      if (v !== version) {
        version = v;
        lastDbChange = Date.now();
        for (const name of current.keys()) schedule(name);
      }
    } catch (e) {
      handlers.onError?.(asError(e));
    }
  }, pollMs);

  const initial = fsReady.then(() => Promise.all(tables.map((t) => run(t.name))));

  return {
    ready: initial.then(() => undefined),
    async close() {
      closed = true;
      clearInterval(poll);
      for (const timer of timers.values()) clearTimeout(timer);
      timers.clear();
      await Promise.all(fsWatchers.map((w) => w.close()));
      await Promise.all(running.values());
    },
  };
}
