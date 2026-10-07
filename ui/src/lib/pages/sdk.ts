interface SdkWindow {
  parent: { postMessage(message: unknown, target: string): void };
  addEventListener(type: "message", listener: (e: { source: unknown; data: any }) => void): void;
  addEventListener(type: "click", listener: () => void): void;
  addEventListener(
    type: "keydown",
    listener: (e: { key: string; defaultPrevented: boolean; isComposing: boolean }) => void,
  ): void;
  setInterval(fn: () => void, ms: number): unknown;
  clearInterval(handle: unknown): void;
  document: {
    addEventListener(type: "securitypolicyviolation", listener: (e: { blockedURI: string }) => void): void;
    documentElement: { dataset: Record<string, string | undefined> };
  };
}

interface WireError {
  status: number;
  message: string;
  extra?: Record<string, unknown>;
}

// runs inside the page's iframe as the source text of this function: it must not use anything from outside its body
export function pageSdk(
  win: SdkWindow = window as unknown as SdkWindow,
  initialTheme: "light" | "dark" = "light",
): void {
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
  let theme: "light" | "dark" = initialTheme === "dark" ? "dark" : "light";
  win.document.documentElement.dataset.theme = theme;
  const themeListeners = new Set<(data: { theme: "light" | "dark" }) => void>();
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
    if (m.event === "theme") {
      if (m.data?.theme !== "light" && m.data?.theme !== "dark") return;
      if (m.data.theme === theme) return;
      theme = m.data.theme;
      win.document.documentElement.dataset.theme = theme;
      for (const listener of themeListeners) listener({ theme });
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
  // keys and clicks in the frame never reach the host, so the ones that close its layers are passed up
  win.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && !e.defaultPrevented && !e.isComposing) {
      parent.postMessage({ yamlite: 1, method: "escape", args: [] }, "*");
    }
  });
  win.addEventListener("click", () => parent.postMessage({ yamlite: 1, method: "click", args: [] }, "*"));
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
    get theme() {
      return theme;
    },
    on(type: string, listener: (data: any) => void) {
      if (type === "change") {
        listeners.add(listener);
        return () => listeners.delete(listener);
      }
      if (type === "theme") {
        themeListeners.add(listener);
        return () => themeListeners.delete(listener);
      }
      throw new Error('only "change" and "theme" can be subscribed to');
    },
    YamliteError,
  });
}
