import type { ServerResponse } from "node:http";
import type { Change, ConflictInfo, SchemaChange, TableResult, WatchHandlers } from "../index.ts";

export type ServeEvent =
  | {
      type: "sync";
      at: string;
      table: string;
      ok: boolean;
      error?: string;
      changes: Change[];
      warnings: string[];
      schema: SchemaChange[];
    }
  | ({ type: "conflict"; at: string } & ConflictInfo)
  | { type: "error"; at: string; table?: string; message: string }
  | { type: "reload"; at: string; tables: string[] };

const KEEP = 200;
const KEEPALIVE_MS = 15_000;
const sameList = (a: string[] = [], b: string[] = []) => a.length === b.length && a.every((x, i) => x === b[i]);
const now = () => new Date().toISOString();
const jsonReplacer = (_key: string, value: unknown) => (typeof value === "bigint" ? value.toString() : value);

export class EventHub {
  private readonly recent: ServeEvent[] = [];
  private readonly lastWarnings = new Map<string, string[]>();
  private readonly lastOk = new Map<string, boolean>();
  private readonly lastError = new Map<string, string | undefined>();
  private readonly clients = new Map<ServerResponse, NodeJS.Timeout>();
  private brokenConfig: string | null = null;

  readonly handlers: WatchHandlers = {
    onSync: (r) => this.onSync(r),
    onConflict: (c) => this.publish({ type: "conflict", at: now(), ...c }),
    onError: (e, table) => {
      // watch reports a broken yamlite.yaml without a table and keeps the old configuration
      if (table === undefined && e.message.endsWith("keeping the previous configuration"))
        this.brokenConfig = e.message;
      this.publish({ type: "error", at: now(), table, message: e.message });
    },
    onReload: (tables) => {
      this.brokenConfig = null;
      this.publish({ type: "reload", at: now(), tables });
    },
  };

  activity(): ServeEvent[] {
    return [...this.recent];
  }

  warnings(): Record<string, string[]> {
    return Object.fromEntries(this.lastWarnings);
  }

  configError(): string | null {
    return this.brokenConfig;
  }

  subscribe(res: ServerResponse): void {
    res.writeHead(200, {
      "content-type": "text/event-stream; charset=utf-8",
      "cache-control": "no-store",
      connection: "keep-alive",
    });
    this.send(res, "hello", { activity: this.activity(), warnings: this.warnings(), configError: this.brokenConfig });
    const ping = setInterval(() => res.write(": ping\n\n"), KEEPALIVE_MS);
    this.clients.set(res, ping);
    res.on("close", () => {
      clearInterval(ping);
      this.clients.delete(res);
    });
  }

  close(): void {
    for (const [res, ping] of this.clients) {
      clearInterval(ping);
      res.end();
    }
    this.clients.clear();
  }

  // every database commit re-syncs every table, so only syncs that tell the UI something are streamed (a repeated identical failure is not news)
  private onSync(r: TableResult): void {
    const unchanged =
      r.changes.length === 0 && r.schema.length === 0 && sameList(this.lastWarnings.get(r.table), r.warnings);
    const quiet = r.ok
      ? unchanged && this.lastOk.get(r.table) !== false
      : unchanged && this.lastOk.get(r.table) === false && this.lastError.get(r.table) === r.error;
    this.lastError.set(r.table, r.error);
    this.lastWarnings.set(r.table, r.warnings);
    this.lastOk.set(r.table, r.ok);
    if (quiet) return;
    this.publish({
      type: "sync",
      at: now(),
      table: r.table,
      ok: r.ok,
      error: r.error,
      changes: r.changes,
      warnings: r.warnings,
      schema: r.schema,
    });
  }

  private publish(event: ServeEvent): void {
    this.recent.push(event);
    if (this.recent.length > KEEP) this.recent.splice(0, this.recent.length - KEEP);
    for (const res of this.clients.keys()) this.send(res, event.type, event);
  }

  private send(res: ServerResponse, type: string, data: unknown): void {
    res.write(`event: ${type}\ndata: ${JSON.stringify(data, jsonReplacer)}\n\n`);
  }
}
