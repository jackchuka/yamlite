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
  | { type: "reload"; at: string; tables: string[] }
  | { type: "page"; at: string; pages: string[] };

const KEEP = 200;
const KEEPALIVE_MS = 15_000;
const sameList = (a: string[] = [], b: string[] = []) => a.length === b.length && a.every((x, i) => x === b[i]);
const encoder = new TextEncoder();
const now = () => new Date().toISOString();
const jsonReplacer = (_key: string, value: unknown) => (typeof value === "bigint" ? value.toString() : value);

export class EventHub {
  private readonly recent: ServeEvent[] = [];
  private readonly lastWarnings = new Map<string, string[]>();
  private readonly lastOk = new Map<string, boolean>();
  private readonly lastError = new Map<string, string | undefined>();
  private readonly clients = new Map<ReadableStreamDefaultController<Uint8Array>, ReturnType<typeof setInterval>>();
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

  // nothing to keep in the activity: an open page just reloads
  pagesChanged(pages: string[]): void {
    const event: ServeEvent = { type: "page", at: now(), pages };
    for (const res of this.clients.keys()) this.send(res, event.type, event);
  }

  stream(signal: AbortSignal): ReadableStream<Uint8Array> {
    let ctrl!: ReadableStreamDefaultController<Uint8Array>;
    const drop = () => {
      const ping = this.clients.get(ctrl);
      if (ping === undefined) return;
      clearInterval(ping);
      this.clients.delete(ctrl);
      try {
        ctrl.close();
      } catch {}
    };
    return new ReadableStream<Uint8Array>({
      start: (c) => {
        ctrl = c;
        this.send(c, "hello", { activity: this.activity(), warnings: this.warnings(), configError: this.brokenConfig });
        this.clients.set(
          c,
          setInterval(() => c.enqueue(encoder.encode(": ping\n\n")), KEEPALIVE_MS),
        );
        signal.addEventListener("abort", drop, { once: true });
      },
      cancel: drop,
    });
  }

  close(): void {
    for (const [ctrl, ping] of this.clients) {
      clearInterval(ping);
      try {
        ctrl.close();
      } catch {}
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

  private send(ctrl: ReadableStreamDefaultController<Uint8Array>, type: string, data: unknown): void {
    ctrl.enqueue(encoder.encode(`event: ${type}\ndata: ${JSON.stringify(data, jsonReplacer)}\n\n`));
  }
}
