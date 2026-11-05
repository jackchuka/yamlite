import { realpathSync } from "node:fs";
import { basename, dirname, isAbsolute, join, relative, sep } from "node:path";
import type { AgentHost } from "../agent/host.ts";
import type { ProposalStore } from "../agent/proposals.ts";
import type { WorkspaceDriver } from "../git/driver.ts";
import type { Yamlite } from "../index.ts";
import { DENIED_FILES } from "../pages/access.ts";
import type { Store } from "../store.ts";
import type { Reference, TableSpec, ViewRecord } from "../types.ts";
import { declaredViews } from "../views.ts";
import type { EventHub } from "./events.ts";
import { HttpError } from "./http.ts";
import type { PageSql } from "./pagesql.ts";
import type { MetaReference } from "./types.ts";
import type { WorkspaceOptions } from "./workspace.ts";

export interface ApiContext {
  y: Yamlite;
  // the UI's own connection: its commits change data_version, which the watcher picks up
  store: Store;
  pageSql: PageSql;
  root: string;
  stateDir: string;
  configFile: string;
  dbPath: string;
  hub: EventHub;
  // agent proposals; present even when no agent is offered, so the routes stay simple
  proposals: ProposalStore;
  agent: AgentHost | null;
  // reads and writes git for the root; null when there is no git
  git: WorkspaceDriver | null;
  // applies yamlite.yaml now, after a route wrote it
  reloadConfig: () => void;
  // a host's own source for page files, asked before the working tree
  pageFiles: WorkspaceOptions["pageFiles"] | null;
  // root-relative paths no page may read, whatever its files say
  deniedFiles: string[];
}

// the path as the disk spells it (symlinks followed, true case); one not created yet is resolved through its folder
function onDisk(path: string): string {
  try {
    return realpathSync.native(path);
  } catch {
    try {
      return join(realpathSync.native(dirname(path)), basename(path));
    } catch {
      return path;
    }
  }
}

// the state folder and the database are denied too when they sit inside the root; spelled as the route's real paths are.
// A symlinked database is denied under the name given and the file it resolves to, since SQLite keeps its sidecars by the latter
export function deniedFiles(root: string, stateDir: string, dbPath: string): string[] {
  const base = onDisk(root);
  const inside = (path: string) => {
    const rel = relative(base, path);
    return rel === "" || rel.startsWith("..") || isAbsolute(rel) ? null : rel.split(sep).join("/");
  };
  const state = inside(onDisk(stateDir));
  const given = inside(join(onDisk(dirname(dbPath)), basename(dbPath)));
  const dbs = [...new Set([given, inside(onDisk(dbPath))])].filter((db) => db !== null);
  return [
    ...DENIED_FILES,
    ...(state === null ? [] : [`${state}/`]),
    ...dbs.flatMap((db) => [db, `${db}-wal`, `${db}-shm`, `${db}-journal`]),
  ];
}

// relative to the root when inside it (--db and listed tables may live elsewhere)
export function displayPath(root: string, path: string): string {
  const rel = relative(root, path);
  return rel === "" || rel.startsWith("..") ? path : rel;
}

export interface ViewTarget {
  name: string;
  table: TableSpec;
  // set only when the view exists in the database
  record: ViewRecord | undefined;
}

export function findView(ctx: ApiContext, name: string): ViewTarget | undefined {
  const table = ctx.y.tables.find((t) => declaredViews(t).some((d) => d.spec.name === name));
  if (!table) return undefined;
  const record = ctx.store.registeredView(name);
  return { name, table, record: record && ctx.store.objectType(name) === "view" ? record : undefined };
}

export function tableSpec(ctx: ApiContext, name: string): TableSpec {
  const spec = ctx.y.tables.find((t) => t.name === name);
  if (spec) return spec;
  if (findView(ctx, name)) throw new HttpError(405, `${name} is a read-only view`);
  throw new HttpError(404, `unknown table: ${name}`);
}

// a reference without a target points at the referenced table's key; undefined when that table is undeclared
export const referenceKey = (ctx: ApiContext, ref: Reference): string | undefined =>
  ref.target ?? ctx.y.tables.find((t) => t.name === ref.table)?.key;

export const referenceTarget = (ctx: ApiContext, ref: Reference): string => referenceKey(ctx, ref) ?? "id";

// target stays as the config wrote it, so a client that saves the references back leaves them unchanged
export const keyedReferences = (ctx: ApiContext, refs: Reference[]): MetaReference[] =>
  refs.map((r) => {
    const key = referenceKey(ctx, r);
    return key === undefined ? r : { ...r, key };
  });
