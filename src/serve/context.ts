import { relative } from "node:path";
import type { Yamlite } from "../index.ts";
import type { Store } from "../store.ts";
import type { TableSpec } from "../types.ts";
import type { EventHub } from "./events.ts";
import { HttpError } from "./http.ts";

export interface ApiContext {
  y: Yamlite;
  // the UI's own connection: its commits change data_version, which the watcher picks up
  store: Store;
  root: string;
  stateDir: string;
  configFile: string;
  dbPath: string;
  hub: EventHub;
}

// relative to the root when inside it (--db and listed tables may live elsewhere)
export function displayPath(root: string, path: string): string {
  const rel = relative(root, path);
  return rel === "" || rel.startsWith("..") ? path : rel;
}

export function tableSpec(ctx: ApiContext, name: string): TableSpec {
  const spec = ctx.y.tables.find((t) => t.name === name);
  if (!spec) throw new HttpError(404, `unknown table: ${name}`);
  return spec;
}
