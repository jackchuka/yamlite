import type {
  ConflictDetail,
  ConflictEntry,
  Filter,
  HistoryPage,
  Meta,
  RecordDetail,
  Row,
  RowsPage,
  SqlResult,
  TableSchema,
} from "./types";

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
  const fetcher = opts.fetcher ?? fetch;
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
}

const enc = encodeURIComponent;
const rowsPath = (table: string) => `/api/tables/${enc(table)}/rows`;
const rowPath = (table: string, key: string) => `${rowsPath(table)}/${enc(key)}`;

export interface RowsParams {
  limit: number;
  offset: number;
  sort?: string;
  filters: Filter[];
  prefix?: string;
}

export function rowsQuery(p: RowsParams): URLSearchParams {
  const qs = new URLSearchParams({ limit: String(p.limit), offset: String(p.offset) });
  if (p.sort) qs.set("sort", p.sort);
  if (p.filters.length > 0) qs.set("filter", JSON.stringify(p.filters));
  if (p.prefix) qs.set("prefix", p.prefix);
  return qs;
}

export const httpApi = {
  meta: () => request<Meta>("GET", "/api/meta"),
  rows: (table: string, p: RowsParams) => request<RowsPage>("GET", `${rowsPath(table)}?${rowsQuery(p)}`),
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
  pageHtml: (name: string) => request<{ html: string }>("GET", `/api/pages/${enc(name)}/html`).then((r) => r.html),
  pageSql: (name: string, sql: string) => request<SqlResult>("POST", "/api/sql", { sql, page: name }),
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
  sql: (sql) => backend.sql(sql),
  pageHtml: (name) => backend.pageHtml(name),
  pageSql: (name, sql) => backend.pageSql(name, sql),
  conflicts: () => backend.conflicts(),
  conflict: (id) => backend.conflict(id),
  restore: (id, expected) => backend.restore(id, expected),
  dismiss: (id) => backend.dismiss(id),
};
