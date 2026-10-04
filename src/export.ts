import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, isAbsolute, join, resolve } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { configPath } from "./config.ts";
import { q } from "./ident.ts";
import { open } from "./index.ts";
import { Store } from "./store.ts";
import type { ApiContext } from "./serve/context.ts";
import { EventHub } from "./serve/events.ts";
import { Router } from "./serve/http.ts";
import { ROUTES } from "./serve/routes/index.ts";

export interface Snapshot {
  version: 1;
  generatedAt: string;
  meta: unknown;
  schemas: Record<string, unknown>;
  warnings: Record<string, string[]>;
}

export interface ExportOptions {
  root: string;
  out: string;
  tables?: string[];
  force?: boolean;
  uiDir?: string;
  now?: () => Date;
}

export interface ExportResult {
  out: string;
  tables: string[];
  warnings: Record<string, string[]>;
}

type Json = Record<string, any>;

function generatedAt(now: () => Date): string {
  const epoch = process.env.SOURCE_DATE_EPOCH;
  return (epoch ? new Date(Number(epoch) * 1000) : now()).toISOString();
}

// a path outside the root would tell readers of a published site about the machine it was built on
const hidePath = (path: string): string => (isAbsolute(path) ? basename(path) : path);

function get(router: Router, path: string): Json {
  const m = router.match("GET", path);
  if (m === null || m === "method") throw new Error(`no route for ${path}`);
  return m.handler({ params: m.params, query: new URLSearchParams(), body: undefined } as never) as Json;
}

// warnings quote the absolute paths sync read: root-relative inside the root, base name outside it
function warningScrubber(root: string, specPaths: string[]): (warning: string) => string {
  const outside = specPaths.map((p) => resolve(root, p)).filter((p) => p !== root && !p.startsWith(`${root}/`));
  return (warning) => {
    let out = warning;
    for (const p of outside.sort((a, b) => b.length - a.length)) out = out.split(p).join(basename(p));
    return out.split(`${root}/`).join("");
  };
}

const writeJson = (path: string, value: unknown) => writeFileSync(path, JSON.stringify(value));

export async function writeSnapshotData(opts: {
  root: string;
  tables?: string[];
  dir: string;
  now?: () => Date;
}): Promise<{ tables: string[]; warnings: Record<string, string[]> }> {
  const root = resolve(opts.root);
  const work = mkdtempSync(join(tmpdir(), "yamlite-export-"));
  const dbPath = join(work, "db.sqlite");
  try {
    const y = await open({ root, db: dbPath, stateDir: join(work, "state"), persistConfig: false });
    let selected: string[];
    const warnings: Record<string, string[]> = {};
    let meta: Json;
    const schemas: Record<string, unknown> = {};
    const yaml: Record<string, Record<string, { file: string; yaml: string | null }>> = {};
    try {
      const all = y.tables.map((t) => t.name);
      const unknown = (opts.tables ?? []).filter((n) => !all.includes(n));
      if (unknown.length > 0) throw new Error(`unknown table: ${unknown.join(", ")}`);
      selected = opts.tables && opts.tables.length > 0 ? [...new Set(opts.tables)] : all;
      const results = await y.sync();
      const failed = results.filter((r) => !r.ok);
      if (failed.length > 0) throw new Error(failed.map((r) => `${r.table}: ${r.error}`).join("\n"));
      const scrub = warningScrubber(
        root,
        y.tables.map((t) => t.path),
      );
      for (const r of results) {
        if (selected.includes(r.table) && r.warnings.length > 0) warnings[r.table] = r.warnings.map(scrub);
      }

      const store = new Store(dbPath);
      try {
        const ctx: ApiContext = {
          y,
          store,
          root,
          stateDir: join(work, "state"),
          configFile: configPath(root) ?? join(root, "yamlite.yaml"),
          dbPath,
          hub: new EventHub(),
        };
        const router = new Router();
        for (const routes of ROUTES) routes(router, ctx);
        const served = get(router, "/api/meta");
        meta = {
          ...served,
          root: basename(root),
          db: "data/db.sqlite",
          configFile: hidePath(served.configFile),
          tables: selected.flatMap((name) =>
            served.tables.filter((t: Json) => t.name === name).map((t: Json) => ({ ...t, path: hidePath(t.path) })),
          ),
          views: served.views.filter((v: Json) => selected.includes(v.table)),
        };
        for (const name of selected) {
          const schema = get(router, `/api/tables/${encodeURIComponent(name)}/schema`);
          schemas[name] = { ...schema, path: hidePath(schema.path) };
          const spec = y.tables.find((t) => t.name === name);
          const map: Record<string, { file: string; yaml: string | null }> = {};
          if (spec && store.tableExists(name)) {
            const keys = store.query(`SELECT ${q(spec.key)} AS k FROM ${q(name)} ORDER BY ${q(spec.key)}`);
            for (const { k } of keys) {
              const key = String(k);
              const detail = get(router, `/api/tables/${encodeURIComponent(name)}/rows/${encodeURIComponent(key)}`);
              map[key] = { file: hidePath(detail.file), yaml: detail.yaml };
            }
          }
          yaml[name] = map;
        }
      } finally {
        store.close();
      }
    } finally {
      await y.close();
    }

    mkdirSync(join(opts.dir, "data", "yaml"), { recursive: true });
    snapshotDb(dbPath, join(opts.dir, "data", "db.sqlite"), selected);
    const snapshot: Snapshot = {
      version: 1,
      generatedAt: generatedAt(opts.now ?? (() => new Date())),
      meta,
      schemas,
      warnings,
    };
    writeJson(join(opts.dir, "data", "snapshot.json"), snapshot);
    for (const [name, map] of Object.entries(yaml)) writeJson(join(opts.dir, "data", "yaml", `${name}.json`), map);
    return { tables: selected, warnings };
  } finally {
    rmSync(work, { recursive: true, force: true });
  }
}

function snapshotDb(from: string, to: string, selected: string[]): void {
  const src = new DatabaseSync(from);
  try {
    src.prepare("VACUUM INTO ?").run(to);
  } finally {
    src.close();
  }
  const db = new DatabaseSync(to);
  try {
    const views = db.prepare("SELECT name, tbl FROM _yamlite_views").all() as Array<{ name: string; tbl: string }>;
    for (const v of views) if (!selected.includes(v.tbl)) db.exec(`DROP VIEW IF EXISTS ${q(v.name)}`);
    const placeholders = selected.map(() => "?").join(", ");
    db.prepare(`DELETE FROM _yamlite_views WHERE tbl NOT IN (${placeholders})`).run(...selected);
    const tables = db
      .prepare("SELECT name FROM sqlite_schema WHERE type = 'table' AND name NOT LIKE 'sqlite_%'")
      .all() as Array<{ name: string }>;
    for (const { name } of tables) {
      if (name === "_yamlite_views" || selected.includes(name)) continue;
      db.exec(`DROP TABLE ${q(name)}`);
    }
    db.exec("PRAGMA journal_mode = DELETE");
    db.exec("VACUUM");
  } finally {
    db.close();
  }
}
