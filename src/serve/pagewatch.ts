import { dirname } from "node:path";
import { type FSWatcher, watch } from "chokidar";
import type { PageSpec } from "../types.ts";

const SETTLE_MS = 100;

export class PageWatch {
  private watcher: FSWatcher | undefined;
  private names = new Map<string, string[]>();
  private readonly changed = new Set<string>();
  private timer: NodeJS.Timeout | undefined;

  constructor(
    private readonly onChange: (pages: string[]) => void,
    private readonly debounceMs = 100,
  ) {}

  // resolves once the new targets are watched, so a save made right after it is seen
  update(pages: readonly PageSpec[]): Promise<void> {
    const next = new Map<string, string[]>();
    for (const p of pages) next.set(p.path, [...(next.get(p.path) ?? []), p.name]);
    const before = this.targets();
    this.names = next;
    const after = this.targets();
    const gone = [...before].filter((target) => !after.has(target));
    const added = [...after].filter((target) => !before.has(target));
    if (!this.watcher) {
      if (added.length === 0) return Promise.resolve();
      const watcher = watch(added, { ignoreInitial: true, depth: 0 });
      this.watcher = watcher;
      watcher.on("all", (event, path) => this.seen(event, path));
      // chokidar reports ready before the OS watcher (FSEvents on macOS) delivers events, as in src/watch.ts
      return new Promise((r) => watcher.once("ready", () => setTimeout(r, SETTLE_MS)));
    }
    if (gone.length > 0) this.watcher.unwatch(gone);
    if (added.length > 0) this.watcher.add(added);
    return Promise.resolve();
  }

  private seen(event: string, path: string): void {
    if (event !== "addDir" || !this.dirs().has(path)) return this.fire(path);
    // a folder that appears after the watch was added is reported, but its files only once it is watched again
    this.watcher?.unwatch(path);
    this.watcher?.add(path);
    for (const [file, names] of this.names) if (dirname(file) === path) this.fire(file, names);
  }

  private dirs(): Set<string> {
    return new Set([...this.names.keys()].map((path) => dirname(path)));
  }

  // the files themselves, which are reported at once, and their folders, which are the only way to learn of a file whose folder did not exist yet
  private targets(): Set<string> {
    return new Set([...this.names.keys(), ...this.dirs()]);
  }

  private fire(path: string, names = this.names.get(path) ?? []): void {
    for (const name of names) this.changed.add(name);
    clearTimeout(this.timer);
    this.timer = setTimeout(() => {
      const pages = [...this.changed];
      this.changed.clear();
      if (pages.length > 0) this.onChange(pages);
    }, this.debounceMs);
  }

  async close(): Promise<void> {
    clearTimeout(this.timer);
    await this.watcher?.close();
  }
}
