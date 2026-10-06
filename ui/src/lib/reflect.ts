import type { Meta, ServeEvent } from "./types";
import { m } from "@/paraglide/messages.js";

export type Reflect =
  | { state: "pending"; since: number }
  | { state: "applied"; file: string }
  | { state: "failed"; reason: string }
  | { state: "waiting" };

export type ReflectMap = Record<string, Reflect>;

export type ReflectAction =
  | { type: "saved"; table: string; key: string; at: number }
  | { type: "cancelled"; table: string; key: string }
  | { type: "event"; event: ServeEvent }
  | { type: "tick"; now: number };

export const WAIT_MS = 5000;
export const reflectKey = (table: string, key: string): string => `${table}\u0000${key}`;
const open = (r: Reflect | undefined) => r?.state === "pending" || r?.state === "waiting";

export function reflectReducer(
  state: ReflectMap,
  action: ReflectAction,
  fileOf: (table: string, key: string) => string,
): ReflectMap {
  if (action.type === "saved") {
    return { ...state, [reflectKey(action.table, action.key)]: { state: "pending", since: action.at } };
  }
  if (action.type === "cancelled") {
    const { [reflectKey(action.table, action.key)]: _gone, ...rest } = state;
    return rest;
  }
  if (action.type === "tick") {
    let next = state;
    for (const [k, r] of Object.entries(state)) {
      if (r.state === "pending" && action.now - r.since >= WAIT_MS) next = { ...next, [k]: { state: "waiting" } };
    }
    return next;
  }
  const e = action.event;
  if (e.type !== "sync") return state;
  let next = state;
  const prefix = `${e.table}\u0000`;
  for (const [k, r] of Object.entries(state)) {
    if (!k.startsWith(prefix) || !open(r)) continue;
    const key = k.slice(prefix.length);
    if (!e.ok) {
      next = { ...next, [k]: { state: "failed", reason: e.error ?? m.activity_sync_failed() } };
      continue;
    }
    if (e.changes.some((c) => c.key === key && (c.op === "toFile" || c.op === "deleteFile"))) {
      next = { ...next, [k]: { state: "applied", file: fileOf(e.table, key) } };
      continue;
    }
    // engine warnings about one record start with "<key>: "
    const warning = e.warnings.find((w) => w.startsWith(`${key}: `));
    if (warning) next = { ...next, [k]: { state: "failed", reason: warning.slice(key.length + 2) } };
  }
  return next;
}

export function recordFileOf(meta: Meta | undefined): (table: string, key: string) => string {
  return (table, key) => {
    const t = meta?.tables.find((x) => x.name === table);
    if (!t) return `${table}/${key}`;
    return t.mode === "list" ? t.path : `${t.path}/${key}.yaml`;
  };
}
