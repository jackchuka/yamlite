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
  initialPath = "/",
  // the host's own path rules, handed over as their source
  pagePath: (to: unknown, from?: string) => string | null,
  initialState: unknown = null,
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
  // yamlite.history follows the history package's shape, which routers such as React Router take
  type To = string | { pathname?: string; search?: string; hash?: string };
  type Location = { pathname: string; search: string; hash: string; state: unknown; key: string };
  type Action = "POP" | "PUSH" | "REPLACE";
  const historyListeners = new Set<(update: { action: Action; location: Location }) => void>();
  let keys = 0;
  const at = (path: string, state: unknown): Location => {
    const u = new URL(path, "http://page");
    return { pathname: u.pathname, search: u.search, hash: u.hash, state, key: String(keys++) };
  };
  let location = at(initialPath, initialState);
  let action: Action = "POP";
  // a path the host would refuse is refused here, before the page moves to it
  const href = (to: To) => {
    const text = typeof to === "string" ? to : `${to.pathname ?? location.pathname}${to.search ?? ""}${to.hash ?? ""}`;
    const path = pagePath(text, location.pathname + location.search + location.hash);
    if (path === null) throw new Error(`${text} is not a path inside the page`);
    return path;
  };
  const moved = (a: Action, path: string, state: unknown) => {
    action = a;
    location = at(path, state);
    for (const listener of historyListeners) listener({ action, location });
  };
  let next = 0;
  const send = (method: string, args: unknown[]) => {
    const id = ++next;
    const answer = new Promise<any>((resolve, reject) => {
      pending.set(id, { resolve, reject });
      parent.postMessage({ yamlite: 1, id, method, args }, "*");
    });
    return { id, answer };
  };
  const call = (method: string, ...args: unknown[]) => send(method, args).answer;
  const streams = new Map<number, (text: string) => void>();
  // built by hand: compiled down, an async generator would call helpers from outside this function's body
  const stream = (input: unknown) => {
    const { id, answer } = send("ai-stream", [input]);
    const queue: string[] = [];
    let waiting: { resolve: (r: IteratorResult<string>) => void; reject: (e: unknown) => void } | null = null;
    let ended = false;
    let failure: { error: unknown } | null = null;
    const finish = () => {
      ended = true;
      streams.delete(id);
    };
    streams.set(id, (text) => {
      if (waiting) {
        const w = waiting;
        waiting = null;
        w.resolve({ value: text, done: false });
      } else queue.push(text);
    });
    answer.then(
      () => {
        finish();
        if (waiting) waiting.resolve({ value: undefined, done: true });
        waiting = null;
      },
      (error: unknown) => {
        finish();
        if (waiting) waiting.reject(error);
        else failure = { error };
        waiting = null;
      },
    );
    const iterator: AsyncIterableIterator<string> = {
      next() {
        if (queue.length > 0) return Promise.resolve({ value: queue.shift() as string, done: false });
        if (failure) {
          const { error } = failure;
          failure = null;
          return Promise.reject(error);
        }
        if (ended) return Promise.resolve({ value: undefined, done: true });
        return new Promise<IteratorResult<string>>((resolve, reject) => {
          waiting = { resolve, reject };
        });
      },
      return() {
        if (!ended) {
          finish();
          pending.delete(id);
          parent.postMessage({ yamlite: 1, method: "ai-cancel", args: [id] }, "*");
        }
        queue.length = 0;
        failure = null;
        if (waiting) waiting.resolve({ value: undefined, done: true });
        waiting = null;
        return Promise.resolve({ value: undefined, done: true });
      },
      [Symbol.asyncIterator]() {
        return iterator;
      },
    };
    return iterator;
  };
  win.addEventListener("message", (e) => {
    const m = e.data;
    if (e.source !== parent || m === null || typeof m !== "object" || m.yamlite !== 1) return;
    if (m.event === "change") {
      for (const listener of listeners) listener(m.data);
      return;
    }
    if (m.event === "location") {
      const path = pagePath(m.data?.path);
      if (path !== null) moved("POP", path, m.data.state ?? null);
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
    // a stream's deltas carry its call's id, but only the answer settles the call
    if (m.event === "ai-delta") {
      if (typeof m.data?.text === "string") streams.get(m.id)?.(m.data.text);
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
    ai: Object.freeze({
      generate: (input: Record<string, unknown>) => call("ai", input),
      stream,
    }),
    history: Object.freeze({
      get action() {
        return action;
      },
      get location() {
        return location;
      },
      // posted first: a state that cannot be cloned throws there, before the page moves
      push(to: To, state: unknown = null) {
        const path = href(to);
        parent.postMessage({ yamlite: 1, method: "navigate", args: [path, false, state] }, "*");
        moved("PUSH", path, state);
      },
      replace(to: To, state: unknown = null) {
        const path = href(to);
        parent.postMessage({ yamlite: 1, method: "navigate", args: [path, true, state] }, "*");
        moved("REPLACE", path, state);
      },
      go: (delta: number) => parent.postMessage({ yamlite: 1, method: "go", args: [delta] }, "*"),
      back: () => parent.postMessage({ yamlite: 1, method: "go", args: [-1] }, "*"),
      forward: () => parent.postMessage({ yamlite: 1, method: "go", args: [1] }, "*"),
      createHref: href,
      listen(listener: (update: { action: Action; location: Location }) => void) {
        historyListeners.add(listener);
        return () => historyListeners.delete(listener);
      },
    }),
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
