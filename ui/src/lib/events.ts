import { transport } from "./transport";
import { api } from "./api";
import type { Hello, ServeEvent } from "./types";

export interface EventState {
  connected: boolean;
  activity: ServeEvent[];
  warnings: Record<string, string[]>;
  configError: string | null;
  lastSyncAt: string | null;
  unseenConflicts: number;
}

const INITIAL: EventState = {
  connected: false,
  activity: [],
  warnings: {},
  configError: null,
  lastSyncAt: null,
  unseenConflicts: 0,
};
const CLOSED = 2; // EventSource.CLOSED
const KEEP = 200;
const TYPES = ["sync", "conflict", "error", "reload", "page"] as const;

// EventSource also fires a data-less `error` Event on connection trouble, which shares the name of the server's `error` event
function parseFrame<T>(m: Event): T | null {
  if (!(m instanceof MessageEvent) || typeof m.data !== "string") return null;
  try {
    return JSON.parse(m.data) as T;
  } catch {
    return null;
  }
}

type Listener = (e: ServeEvent | { type: "hello" }) => void;

export class EventStore {
  private state = INITIAL;
  private readonly subscribers = new Set<() => void>();
  private readonly listeners = new Set<Listener>();
  private source: EventSource | null = null;

  connect(url = "/api/events", make: (url: string) => EventSource = (u) => transport().eventSource(u)): void {
    const source = make(url);
    this.source = source;
    source.addEventListener("hello", (m) => {
      const h = parseFrame<Hello>(m);
      if (h) this.hello(h);
    });
    for (const type of TYPES) {
      source.addEventListener(type, (m) => {
        const ev = parseFrame<ServeEvent>(m);
        if (ev) this.apply(ev);
      });
    }
    // EventSource reconnects by itself; hello marks the stream as live again
    source.onerror = () => {
      this.set({ connected: false });
      // a 401 closes the stream for good instead of retrying; any request then shows the session as expired
      if (source.readyState === CLOSED) api.meta().catch(() => {});
    };
  }

  close(): void {
    this.source?.close();
    this.source = null;
  }

  getSnapshot = (): EventState => this.state;

  subscribe = (subscriber: () => void): (() => void) => {
    this.subscribers.add(subscriber);
    return () => this.subscribers.delete(subscriber);
  };

  listen(listener: Listener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  hello(h: Hello): void {
    const lastSync = [...h.activity].reverse().find((e) => e.type === "sync");
    this.set({
      connected: true,
      activity: h.activity,
      warnings: h.warnings,
      configError: h.configError,
      lastSyncAt: lastSync?.at ?? this.state.lastSyncAt,
    });
    this.emit({ type: "hello" });
  }

  apply(e: ServeEvent): void {
    if (e.type === "page") {
      this.emit(e);
      return;
    }
    const patch: Partial<EventState> = { activity: [...this.state.activity, e].slice(-KEEP) };
    if (e.type === "sync") {
      patch.warnings = { ...this.state.warnings, [e.table]: e.warnings };
      patch.lastSyncAt = e.at;
    } else if (e.type === "conflict") {
      patch.unseenConflicts = this.state.unseenConflicts + 1;
    } else if (e.type === "reload") {
      patch.configError = null;
    } else if (e.table === undefined && e.message.endsWith("keeping the previous configuration")) {
      patch.configError = e.message;
    }
    this.set(patch);
    this.emit(e);
  }

  markConflictsSeen(): void {
    if (this.state.unseenConflicts > 0) this.set({ unseenConflicts: 0 });
  }

  private set(patch: Partial<EventState>): void {
    this.state = { ...this.state, ...patch };
    for (const subscriber of this.subscribers) subscriber();
  }

  private emit(e: ServeEvent | { type: "hello" }): void {
    for (const listener of this.listeners) listener(e);
  }
}
