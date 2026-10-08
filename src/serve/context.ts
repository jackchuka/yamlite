import { relative } from "node:path";
import type { AgentHost } from "../agent/host.ts";
import type { ProposalStore } from "../agent/proposals.ts";
import type { GitDriver } from "../git/driver.ts";
import type { Repo } from "../git/repo.ts";
import type { Yamlite } from "../index.ts";
import type { Store } from "../store.ts";
import type { TableSpec, ViewRecord } from "../types.ts";
import { declaredViews } from "../views.ts";
import type { EventHub } from "./events.ts";
import { HttpError } from "./http.ts";
import type { PageSql } from "./pagesql.ts";

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
  // the git repository holding the root and how git reaches its remote; null outside a repository
  git: { repo: Repo; driver: GitDriver } | null;
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
