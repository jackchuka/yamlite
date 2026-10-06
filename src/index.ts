import { resolve } from "node:path";
import { configPath, filesOf, isConventional, listedTables, type OpenOptions, resolveConfig } from "./config.ts";
import { registerInConfig } from "./configfile.ts";
import { type EngineContext, syncTable, type TableResult } from "./engine.ts";
import { acquireLock } from "./lock.ts";
import { checkReferences } from "./references.ts";
import { checkRequired } from "./required.ts";
import { checkBounds, checkFormats } from "./rulecheck.ts";
import { Store } from "./store.ts";
import type { PageSpec, TableSpec } from "./types.ts";
import { checkValues } from "./values.ts";
import { startWatch, type Watcher, type WatchHandlers, type WatchOptions } from "./watch.ts";

export { check, type CheckResult, type CheckTable } from "./check.ts";
export type { OpenOptions, TableInput } from "./config.ts";
export { exportSite, type ExportOptions, type ExportResult } from "./export.ts";
export { generateConfig, init, type InitOptions } from "./init.ts";
export type { Change, ChangeOp, ConflictInfo, TableResult } from "./engine.ts";
export type { SchemaChange } from "./indexes.ts";
export { formatCsv, formatJson, formatTable, type QueryOptions, type QueryResult, query } from "./query.ts";
export type { Decision } from "./reconcile.ts";
export type { ColumnType, IndexSpec, PageSpec, TableSpec } from "./types.ts";
export type { Watcher, WatchHandlers, WatchOptions } from "./watch.ts";

export interface Yamlite {
  readonly tables: readonly TableSpec[];
  readonly pages: readonly PageSpec[];
  status(opts?: { tables?: string[] }): Promise<TableResult[]>;
  sync(opts?: { tables?: string[]; force?: boolean; forceConvert?: boolean }): Promise<TableResult[]>;
  watch(handlers?: WatchHandlers, options?: WatchOptions): Watcher;
  close(): Promise<void>;
}

export async function open(options: OpenOptions): Promise<Yamlite> {
  const config = resolveConfig(options);
  const store = new Store(config.db);
  const file = options.root === undefined || options.persistConfig === false ? null : configPath(options.root);
  const ctx: EngineContext = {
    store,
    stateDir: config.stateDir,
    register:
      options.root === undefined
        ? undefined
        : (table, columns) => {
            if (file) registerInConfig(file, [{ table, columns }]);
            const spec = config.tables.find((t) => t.name === table);
            if (spec) Object.assign(spec.columns, columns);
          },
  };
  // tables found by the folder conventions but missing from yamlite.yaml are added to it
  const registerTables = () => {
    if (!file) return;
    const listed = new Set(Object.keys(listedTables(file)));
    const root = resolve(options.root as string);
    const missing = config.tables
      .filter((t) => t.persisted && !listed.has(t.name))
      .map((t) => ({
        table: t.name,
        files: t.mode === "files" && !isConventional(root, t) ? filesOf(root, t) : undefined,
      }));
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
  const withChecks = (results: TableResult[]): TableResult[] => {
    for (const r of results) {
      const spec = config.tables.find((t) => t.name === r.table);
      if (r.ok && spec) {
        r.warnings.push(
          ...checkValues(store, spec),
          ...checkRequired(store, spec),
          ...checkFormats(store, spec),
          ...checkBounds(store, spec),
          ...checkReferences(store, spec, config.tables),
        );
      }
    }
    return results;
  };

  return {
    get tables() {
      return config.tables;
    },
    get pages() {
      return config.pages;
    },
    async status(opts = {}) {
      if (closed) throw new Error("yamlite is closed");
      const dbTime = store.lastWriteMs();
      return withChecks(select(opts.tables).map((t) => syncTable(ctx, t, { dryRun: true, dbTime })));
    },
    async sync(opts = {}) {
      if (closed) throw new Error("yamlite is closed");
      const tables = select(opts.tables);
      // read before this sync writes anything, so that only other writers move it
      const dbTime = store.lastWriteMs();
      lock();
      registerTables();
      return withChecks(
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
                const next = resolveConfig(options);
                config.tables = next.tables;
                config.pages = next.pages;
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
