import { configPath, listedTables, type OpenOptions, resolveConfig } from "./config.ts";
import { registerInConfig } from "./configfile.ts";
import { type EngineContext, syncTable, type TableResult } from "./engine.ts";
import { acquireLock } from "./lock.ts";
import { checkReferences } from "./references.ts";
import { Store } from "./store.ts";
import type { TableSpec } from "./types.ts";
import { startWatch, type Watcher, type WatchHandlers, type WatchOptions } from "./watch.ts";

export type { OpenOptions, TableInput } from "./config.ts";
export { generateConfig, init, type InitOptions } from "./init.ts";
export type { Change, ChangeOp, ConflictInfo, TableResult } from "./engine.ts";
export type { SchemaChange } from "./indexes.ts";
export type { Decision } from "./reconcile.ts";
export type { ColumnType, IndexSpec, TableSpec } from "./types.ts";
export type { Watcher, WatchHandlers, WatchOptions } from "./watch.ts";

export interface Yamlite {
  readonly tables: readonly TableSpec[];
  status(opts?: { tables?: string[] }): Promise<TableResult[]>;
  sync(opts?: { tables?: string[]; force?: boolean; forceConvert?: boolean }): Promise<TableResult[]>;
  watch(handlers?: WatchHandlers, options?: WatchOptions): Watcher;
  close(): Promise<void>;
}

export async function open(options: OpenOptions): Promise<Yamlite> {
  const config = resolveConfig(options);
  const store = new Store(config.db);
  const file = options.root === undefined ? null : configPath(options.root);
  const ctx: EngineContext = {
    store,
    stateDir: config.stateDir,
    register: file
      ? (table, columns) => {
          registerInConfig(file, [{ table, columns }]);
          const spec = config.tables.find((t) => t.name === table);
          if (spec) Object.assign(spec.columns, columns);
        }
      : undefined,
  };
  // tables found by the folder conventions but missing from yamlite.yaml are added to it
  const registerTables = () => {
    if (!file) return;
    const listed = new Set(Object.keys(listedTables(file)));
    const missing = config.tables.filter((t) => t.persisted && !listed.has(t.name)).map((t) => ({ table: t.name }));
    if (missing.length > 0) registerInConfig(file, missing);
  };
  let release: (() => void) | undefined;
  let closed = false;
  let watcher: Watcher | undefined;

  const lock = () => {
    release ??= acquireLock(config.stateDir);
  };
  const select = (names: string[] = []): TableSpec[] => {
    if (names.length === 0) return config.tables;
    const unknown = names.filter((n) => !config.tables.some((t) => t.name === n));
    if (unknown.length > 0) throw new Error(`unknown table: ${unknown.join(", ")}`);
    return config.tables.filter((t) => names.includes(t.name));
  };

  // checked after every table has synced, so the result does not depend on the order of tables
  const withReferences = (results: TableResult[]): TableResult[] => {
    for (const r of results) {
      const spec = config.tables.find((t) => t.name === r.table);
      if (r.ok && spec) r.warnings.push(...checkReferences(store, spec, config.tables));
    }
    return results;
  };

  return {
    get tables() {
      return config.tables;
    },
    async status(opts = {}) {
      if (closed) throw new Error("yamlite is closed");
      const dbTime = store.lastWriteMs();
      return withReferences(select(opts.tables).map((t) => syncTable(ctx, t, { dryRun: true, dbTime })));
    },
    async sync(opts = {}) {
      if (closed) throw new Error("yamlite is closed");
      const tables = select(opts.tables);
      // read before this sync writes anything, so that only other writers move it
      const dbTime = store.lastWriteMs();
      lock();
      registerTables();
      return withReferences(
        tables.map((t) => syncTable(ctx, t, { force: opts.force, forceConvert: opts.forceConvert, dbTime })),
      );
    },
    watch(handlers = {}, opts = {}) {
      if (closed) throw new Error("yamlite is closed");
      if (watcher) throw new Error("already watching");
      lock();
      const source =
        options.root === undefined
          ? undefined
          : {
              root: options.root,
              reload: () => {
                config.tables = resolveConfig(options).tables;
                registerTables();
                return config.tables;
              },
            };
      registerTables();
      watcher = startWatch(ctx, config.tables, handlers, opts, source);
      return watcher;
    },
    async close() {
      if (closed) return;
      closed = true;
      try {
        await watcher?.close();
        store.close();
      } finally {
        release?.();
      }
    },
  };
}
