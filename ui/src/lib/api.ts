import type {
  ConflictDetail,
  ConflictEntry,
  Filter,
  HistoryPage,
  Meta,
  RecordDetail,
  Row,
  RowsPage,
  RuleTarget,
  Rules,
  RulesPreview,
  SchemaEdit,
  SearchResult,
  SqlResult,
  TableSchema,
} from "./types";
import { transport } from "./transport";

export class ApiError extends Error {
  constructor(
    readonly status: number,
    message: string,
    readonly body: Record<string, unknown>,
  ) {
    super(message);
  }
}

let expired = false;
const listeners = new Set<() => void>();

// a restarted `yamlite serve` has a new token; the open tab must be reopened from the printed URL
export const session = {
  expired: () => expired,
  subscribe(listener: () => void): () => void {
    listeners.add(listener);
    return () => listeners.delete(listener);
  },
};

function markExpired(): void {
  if (expired) return;
  expired = true;
  for (const listener of listeners) listener();
}

const RETRIES = 3;

export async function request<T>(
  method: string,
  path: string,
  body?: unknown,
  opts: { fetcher?: typeof fetch; retryDelayMs?: number } = {},
): Promise<T> {
  const fetcher = opts.fetcher ?? transport().fetch;
  const delay = opts.retryDelayMs ?? 200;
  for (let attempt = 0; ; attempt++) {
    const res = await fetcher(path, {
      method,
      credentials: "same-origin",
      // the server rejects any other content type on writes, bodyless ones included
      headers: method === "GET" && body === undefined ? {} : { "content-type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    if (res.status === 503 && attempt < RETRIES) {
      await new Promise((r) => setTimeout(r, delay * 2 ** attempt));
      continue;
    }
    return answer<T>(res);
  }
}

async function answer<T>(res: Response): Promise<T> {
  if (res.status === 401) markExpired();
  const text = await res.text();
  let data: Record<string, unknown> | null = null;
  try {
    data = text ? (JSON.parse(text) as Record<string, unknown>) : null;
  } catch {
    // proxies and plain-text errors are not JSON
    if (res.ok) throw new ApiError(res.status, "invalid response from server", {});
    data = { error: text || res.statusText };
  }
  if (!res.ok) throw new ApiError(res.status, String(data?.error ?? res.statusText), data ?? {});
  return data as T;
}

export interface PageAiInput {
  system?: string;
  prompt: unknown;
  schema?: Record<string, unknown>;
  model?: string;
  maxOutputTokens?: number;
}

// a model's answer is not a busy database: a page's AI call is sent once, never retried
const postPageAi = (path: string, body: unknown, signal?: AbortSignal) =>
  transport().fetch(path, {
    method: "POST",
    credentials: "same-origin",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
    signal,
  });

function sseEvent(block: string): { event: string; data: string } | null {
  let event = "message";
  const data: string[] = [];
  for (const line of block.split("\n")) {
    if (line === "" || line.startsWith(":")) continue;
    const at = line.indexOf(":");
    const field = at === -1 ? line : line.slice(0, at);
    const value = at === -1 ? "" : line.slice(at + 1).replace(/^ /, "");
    if (field === "event") event = value;
    else if (field === "data") data.push(value);
  }
  return data.length === 0 ? null : { event, data: data.join("\n") };
}

function cutShort(): ApiError {
  const message = "the AI answer ended before it was complete";
  return new ApiError(502, message, { error: message });
}

async function* streamPageAi(path: string, body: unknown, signal: AbortSignal): AsyncGenerator<string> {
  const res = await postPageAi(path, body, signal);
  if (!res.ok) await answer(res);
  if (res.body === null) throw cutShort();
  const reader = res.body.pipeThrough(new TextDecoderStream()).getReader();
  let buffer = "";
  try {
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      buffer = (buffer + value).replace(/\r\n?/g, "\n");
      for (let end = buffer.indexOf("\n\n"); end !== -1; end = buffer.indexOf("\n\n")) {
        const e = sseEvent(buffer.slice(0, end));
        buffer = buffer.slice(end + 2);
        if (e === null) continue;
        const data = JSON.parse(e.data) as Record<string, unknown>;
        if (e.event === "delta" && typeof data.text === "string") yield data.text;
        else if (e.event === "done") return;
        else if (e.event === "error") {
          const { status, ...rest } = data;
          throw new ApiError(typeof status === "number" ? status : 502, String(rest.error), rest);
        }
      }
    }
  } finally {
    void reader.cancel().catch(() => {});
  }
  throw cutShort();
}

const enc = encodeURIComponent;
const rowsPath = (table: string) => `/api/tables/${enc(table)}/rows`;
const rowPath = (table: string, key: string) => `${rowsPath(table)}/${enc(key)}`;

export interface RowsParams {
  limit: number;
  offset: number;
  sort?: string;
  filters: Filter[];
  search?: string;
}

export function searchQuery(needle: string, per: number): URLSearchParams {
  return new URLSearchParams({ q: needle, per: String(per) });
}

export function rowsQuery(p: RowsParams): URLSearchParams {
  const qs = new URLSearchParams({ limit: String(p.limit), offset: String(p.offset) });
  if (p.sort) qs.set("sort", p.sort);
  if (p.filters.length > 0) qs.set("filter", JSON.stringify(p.filters));
  if (p.search) qs.set("q", p.search);
  return qs;
}

export const httpApi = {
  meta: () => request<Meta>("GET", "/api/meta"),
  rows: (table: string, p: RowsParams) => request<RowsPage>("GET", `${rowsPath(table)}?${rowsQuery(p)}`),
  search: (needle: string, per: number) => request<SearchResult>("GET", `/api/search?${searchQuery(needle, per)}`),
  schema: (table: string) => request<TableSchema>("GET", `/api/tables/${enc(table)}/schema`),
  record: (table: string, key: string) => request<RecordDetail>("GET", rowPath(table, key)),
  create: (table: string, key: string, values: Row) =>
    request<{ key: string }>("POST", rowsPath(table), { key, values }),
  update: (table: string, key: string, values: Row, base: Row) =>
    request<{ ok: true }>("PATCH", rowPath(table, key), { values, base }),
  rename: (table: string, key: string, to: string) =>
    request<{ key: string }>("POST", `${rowPath(table, key)}/rename`, { to }),
  remove: (table: string, key: string) => request<{ ok: true }>("DELETE", rowPath(table, key)),
  history: (table: string, key: string, cursor?: string) =>
    request<HistoryPage>(
      "GET",
      `${rowPath(table, key)}/history${cursor === undefined ? "" : `?cursor=${encodeURIComponent(cursor)}`}`,
    ),
  historyDiff: (table: string, key: string, rev: string) =>
    request<{ text: string }>("GET", `${rowPath(table, key)}/history/${enc(rev)}/diff`),
  createTable: (body: {
    name: string;
    mode?: "files" | "list";
    key?: string;
    columns?: Record<string, string>;
    group?: string;
  }) => request<{ name: string }>("POST", "/api/tables", body),
  setGroup: (table: string, group: string | null) =>
    request<{ name: string; group: string | null }>("PATCH", `/api/tables/${enc(table)}`, { group }),
  sql: (sql: string) => request<SqlResult>("POST", "/api/sql", { sql }),
  previewRules: (target: RuleTarget, rules: Rules, base: string, edit: SchemaEdit = {}) =>
    request<RulesPreview>("POST", "/api/rules/preview", { target, rules, base, ...edit }),
  saveRules: (target: RuleTarget, rules: Rules, base: string, edit: SchemaEdit = {}) =>
    request<RulesPreview & { base: string }>("PUT", "/api/rules", { target, rules, base, ...edit }),
  pageHtml: (name: string) => request<{ html: string }>("GET", `/api/pages/${enc(name)}/html`).then((r) => r.html),
  pageSql: (name: string, sql: string) => request<SqlResult>("POST", "/api/sql", { sql, page: name }),
  pageAi: (name: string, body: PageAiInput, signal?: AbortSignal) =>
    postPageAi(`/api/pages/${enc(name)}/ai`, body, signal).then((res) =>
      answer<{ text: string } | { object: unknown }>(res),
    ),
  pageAiStream: (name: string, body: PageAiInput, signal: AbortSignal): AsyncIterable<string> =>
    streamPageAi(`/api/pages/${enc(name)}/ai/stream`, body, signal),
  conflicts: () => request<{ conflicts: ConflictEntry[] }>("GET", "/api/conflicts"),
  conflict: (id: string) => request<ConflictDetail>("GET", `/api/conflicts/${enc(id)}`),
  restore: (id: string, expected?: Row | null) =>
    request<{ ok: true }>(
      "POST",
      `/api/conflicts/${enc(id)}/restore`,
      expected === undefined ? undefined : { expected },
    ),
  dismiss: (id: string) => request<{ ok: true }>("POST", `/api/conflicts/${enc(id)}/dismiss`),
};

export type Api = typeof httpApi;

let backend: Api = httpApi;

// the static export swaps in a backend that answers from the snapshot
export function setBackend(b: Api): void {
  backend = b;
}

export const api: Api = {
  meta: () => backend.meta(),
  rows: (table, p) => backend.rows(table, p),
  search: (needle, per) => backend.search(needle, per),
  schema: (table) => backend.schema(table),
  record: (table, key) => backend.record(table, key),
  create: (table, key, values) => backend.create(table, key, values),
  update: (table, key, values, base) => backend.update(table, key, values, base),
  rename: (table, key, to) => backend.rename(table, key, to),
  remove: (table, key) => backend.remove(table, key),
  history: (table, key, cursor) => backend.history(table, key, cursor),
  historyDiff: (table, key, rev) => backend.historyDiff(table, key, rev),
  createTable: (body) => backend.createTable(body),
  setGroup: (table, group) => backend.setGroup(table, group),
  previewRules: (t, r, b, e) => backend.previewRules(t, r, b, e),
  saveRules: (t, r, b, e) => backend.saveRules(t, r, b, e),
  sql: (sql) => backend.sql(sql),
  pageHtml: (name) => backend.pageHtml(name),
  pageSql: (name, sql) => backend.pageSql(name, sql),
  pageAi: (name, body, signal) => backend.pageAi(name, body, signal),
  pageAiStream: (name, body, signal) => backend.pageAiStream(name, body, signal),
  conflicts: () => backend.conflicts(),
  conflict: (id) => backend.conflict(id),
  restore: (id, expected) => backend.restore(id, expected),
  dismiss: (id) => backend.dismiss(id),
};
