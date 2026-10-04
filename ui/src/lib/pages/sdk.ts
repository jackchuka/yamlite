interface SdkWindow {
  parent: { postMessage(message: unknown, target: string): void };
  addEventListener(type: "message", listener: (e: { source: unknown; data: any }) => void): void;
  setInterval(fn: () => void, ms: number): unknown;
  clearInterval(handle: unknown): void;
  document: { addEventListener(type: "securitypolicyviolation", listener: (e: { blockedURI: string }) => void): void };
}

interface WireError {
  status: number;
  message: string;
  extra?: Record<string, unknown>;
}

// runs inside the page's iframe as the source text of this function: it must not use anything from outside its body
export function pageSdk(win: SdkWindow = window as unknown as SdkWindow): void {
  class YamliteError extends Error {
    readonly status: number;
    readonly extra: Record<string, unknown>;
    constructor(e: WireError) {
      super(e.message);
      this.name = "YamliteError";
      this.status = e.status;
      this.extra = e.extra ?? {};
    }
  }
  const parent = win.parent;
  const pending = new Map<number, { resolve: (v: unknown) => void; reject: (e: unknown) => void }>();
  const listeners = new Set<(data: { tables: string[] }) => void>();
  let next = 0;
  const call = (method: string, ...args: unknown[]) =>
    new Promise<any>((resolve, reject) => {
      const id = ++next;
      pending.set(id, { resolve, reject });
      parent.postMessage({ yamlite: 1, id, method, args }, "*");
    });
  win.addEventListener("message", (e) => {
    const m = e.data;
    if (e.source !== parent || m === null || typeof m !== "object" || m.yamlite !== 1) return;
    if (m.event === "change") {
      for (const listener of listeners) listener(m.data);
      return;
    }
    const waiting = pending.get(m.id);
    if (!waiting) return;
    pending.delete(m.id);
    if (m.ok) waiting.resolve(m.value);
    else waiting.reject(new YamliteError(m.error));
  });
  win.document.addEventListener("securitypolicyviolation", (e) => {
    parent.postMessage({ yamlite: 1, method: "blocked", args: [e.blockedURI] }, "*");
  });
  // the host may not be listening yet when the frame first speaks, so ask again until it answers
  const ready = call("hello");
  const hello = win.setInterval(() => parent.postMessage({ yamlite: 1, id: 1, method: "hello", args: [] }, "*"), 100);
  const stop = () => win.clearInterval(hello);
  ready.then(stop, stop);
  (win as unknown as { yamlite: unknown }).yamlite = Object.freeze({
    ready,
    rows: (table: string, opts: Record<string, unknown> = {}) => call("rows", table, opts),
    get: (table: string, key: string) => call("get", table, key),
    create: (table: string, key: string, values: Record<string, unknown>) => call("create", table, key, values),
    update: (table: string, key: string, values: Record<string, unknown>, base: Record<string, unknown>) =>
      call("update", table, key, values, base),
    remove: (table: string, key: string) => call("remove", table, key),
    sql: (sql: string) => call("sql", sql),
    open: (table: string, key: string) => call("open", table, key),
    on(type: string, listener: (data: { tables: string[] }) => void) {
      if (type !== "change") throw new Error('only "change" can be subscribed to');
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    YamliteError,
  });
}
