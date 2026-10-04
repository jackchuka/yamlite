import { canRead, canWrite, notInAccess, writesAnything } from "../../../../src/pages/access.ts";
import { type Api, ApiError } from "../api";
import type { Filter, Meta, PageMeta, Row } from "../types";

export const READ_ONLY = "this page is read-only here";

export interface HostDeps {
  api: Pick<Api, "rows" | "record" | "create" | "update" | "remove" | "pageSql">;
  readOnly: boolean;
  open(table: string, key: string): void;
  blocked(url: string): void;
  theme(): "light" | "dark";
}

interface PageRequest {
  yamlite: 1;
  id?: number;
  method: string;
  args: unknown[];
}

const isRequest = (d: unknown): d is PageRequest =>
  typeof d === "object" &&
  d !== null &&
  (d as PageRequest).yamlite === 1 &&
  typeof (d as PageRequest).method === "string" &&
  Array.isArray((d as PageRequest).args);

const fail = (status: number, message: string) => new ApiError(status, message, { error: message });

function text(value: unknown, what: string): string {
  if (typeof value !== "string" || value === "") throw fail(400, `${what} must be a non-empty string`);
  return value;
}

function record(value: unknown, what: string): Row {
  if (value === undefined) return {};
  if (value === null || typeof value !== "object" || Array.isArray(value)) throw fail(400, `${what} must be an object`);
  return value as Row;
}

function toWireError(e: unknown) {
  if (e instanceof ApiError) {
    const { error: _message, ...extra } = e.body;
    return { status: e.status, message: e.message, extra };
  }
  return { status: 500, message: e instanceof Error ? e.message : String(e), extra: {} };
}

// the page's only way to the data: every call is checked against the page's access before it reaches the api
export class PageHost {
  private disposed = false;

  constructor(
    private readonly frame: () => Window | null,
    private readonly page: () => PageMeta,
    private readonly meta: () => Meta,
    private readonly deps: HostDeps,
  ) {}

  readonly handle = (e: MessageEvent): void => {
    const frame = this.frame();
    if (this.disposed || frame === null || e.source !== frame || !isRequest(e.data)) return;
    const { id, method, args } = e.data;
    if (method === "blocked") {
      if (typeof args[0] === "string") this.deps.blocked(args[0]);
      return;
    }
    void this.answer(method, args).then(
      (value) => {
        this.post({ yamlite: 1, id, ok: true, value });
        if (method === "hello") this.theme(this.deps.theme());
      },
      (err: unknown) => this.post({ yamlite: 1, id, ok: false, error: toWireError(err) }),
    );
  };

  // a table's views change with it
  notify(tables: string[]): void {
    const touched = new Set(tables);
    for (const v of this.meta().views) if (touched.has(v.table)) touched.add(v.name);
    const visible = [...touched].filter((name) => canRead(this.page(), name));
    if (visible.length > 0) this.post({ yamlite: 1, event: "change", data: { tables: visible } });
  }

  theme(theme: "light" | "dark"): void {
    this.post({ yamlite: 1, event: "theme", data: { theme } });
  }

  dispose(): void {
    this.disposed = true;
  }

  private post(message: unknown): void {
    if (!this.disposed) this.frame()?.postMessage(message, "*");
  }

  private readable(name: unknown): string {
    const table = text(name, "table");
    if (!canRead(this.page(), table)) throw fail(403, notInAccess(table));
    return table;
  }

  private table(name: unknown): string {
    const table = this.readable(name);
    if (!this.meta().tables.some((t) => t.name === table))
      throw fail(400, `${table} is a view; its rows are not records`);
    return table;
  }

  private writable(name: unknown): string {
    const table = this.table(name);
    if (!canWrite(this.page(), table)) throw fail(403, `${table} is read-only for this page`);
    if (this.deps.readOnly) throw fail(403, READ_ONLY);
    return table;
  }

  private async answer(method: string, args: unknown[]): Promise<unknown> {
    const { api } = this.deps;
    const page = this.page();
    switch (method) {
      case "hello":
        return {
          page: page.name,
          title: page.title,
          access: page.access,
          sql: page.sql,
          network: page.network,
          readOnly: this.deps.readOnly || !writesAnything(page),
        };
      case "rows": {
        const table = this.readable(args[0]);
        const o = record(args[1], "options");
        return api.rows(table, {
          limit: typeof o.limit === "number" ? o.limit : 100,
          offset: typeof o.offset === "number" ? o.offset : 0,
          sort: typeof o.sort === "string" ? o.sort : undefined,
          filters: Array.isArray(o.filter) ? (o.filter as Filter[]) : [],
          prefix: typeof o.prefix === "string" ? o.prefix : undefined,
        });
      }
      case "get": {
        const table = this.table(args[0]);
        const { row, file } = await api.record(table, text(args[1], "key"));
        return { row, file };
      }
      case "create": {
        const table = this.writable(args[0]);
        return api.create(table, text(args[1], "key"), record(args[2], "values"));
      }
      case "update": {
        const table = this.writable(args[0]);
        return api.update(table, text(args[1], "key"), record(args[2], "values"), record(args[3], "base"));
      }
      case "remove": {
        const table = this.writable(args[0]);
        return api.remove(table, text(args[1], "key"));
      }
      case "sql":
        if (!page.sql) throw fail(403, `page ${page.name} may not run SQL`);
        return api.pageSql(page.name, text(args[0], "sql"));
      case "open": {
        const table = this.table(args[0]);
        this.deps.open(table, text(args[1], "key"));
        return null;
      }
      default:
        throw fail(400, `unknown method: ${method}`);
    }
  }
}
