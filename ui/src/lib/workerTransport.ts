import type { Transport } from "./transport.ts";

type Out =
  | { id: number; kind: "head"; status: number; headers: [string, string][] }
  | { id: number; kind: "chunk"; data: string }
  | { id: number; kind: "end" };

interface Pending {
  head?: (o: Extract<Out, { kind: "head" }>) => void;
  chunk: (data: string) => void;
  end: () => void;
}

// the UI's fetch and EventSource over a port to the worker that runs the workspace
export function createWorkerTransport(port: MessagePort): Transport {
  let next = 1;
  const pending = new Map<number, Pending>();
  port.onmessage = (e: MessageEvent<Out>) => {
    const m = e.data;
    const p = pending.get(m.id);
    if (!p) return;
    if (m.kind === "head") p.head?.(m);
    else if (m.kind === "chunk") p.chunk(m.data);
    else {
      pending.delete(m.id);
      p.end();
    }
  };
  port.start?.();

  function send(url: string, init: RequestInit, p: Pending): number {
    const id = next++;
    pending.set(id, p);
    const headers = [...new Headers(init.headers)];
    port.postMessage({
      id,
      kind: "request",
      method: init.method ?? "GET",
      url,
      headers,
      body: (init.body as string | undefined) ?? null,
    });
    return id;
  }

  const doFetch = ((input: RequestInfo | URL, init: RequestInit = {}) =>
    new Promise<Response>((resolve, reject) => {
      const signal = init.signal;
      const abortError = () => signal?.reason ?? new DOMException("The operation was aborted.", "AbortError");
      if (signal?.aborted) return reject(abortError());
      const enc = new TextEncoder();
      let body!: ReadableStreamDefaultController<Uint8Array>;
      let settled = false;
      const stream = new ReadableStream<Uint8Array>({
        start: (c) => void (body = c),
        cancel: () => stop(),
      });
      const open = (status: number, headers?: [string, string][]) => {
        settled = true;
        // these statuses forbid a body, so Response throws if given one
        const nullBody = [101, 204, 205, 304].includes(status);
        if (nullBody) void stream.cancel();
        resolve(new Response(nullBody ? null : stream, { status, headers }));
      };
      const onAbort = () => {
        stop();
        const err = abortError();
        if (settled) body.error(err);
        else reject(err);
      };
      const stop = () => {
        signal?.removeEventListener("abort", onAbort);
        if (!pending.delete(id)) return;
        port.postMessage({ id, kind: "abort" });
      };
      const id = send(String(input), init, {
        head: (h) => open(h.status, h.headers),
        chunk: (d) => body.enqueue(enc.encode(d)),
        end: () => {
          signal?.removeEventListener("abort", onAbort);
          if (!settled) open(500);
          body.close();
        },
      });
      signal?.addEventListener("abort", onAbort, { once: true });
    })) as typeof fetch;

  function eventSource(url: string): EventSource {
    const target = new EventTarget() as EventSource;
    let buffer = "";
    let id = 0;
    const s = target as unknown as Record<string, unknown> & { readyState: number; close(): void; url: string };
    s.readyState = 0;
    s.url = url;
    s.CONNECTING = 0;
    s.OPEN = 1;
    s.CLOSED = 2;
    s.onopen = s.onmessage = s.onerror = null;
    const emit = (ev: Event) => {
      target.dispatchEvent(ev);
      if (ev.type === "open" || ev.type === "message" || ev.type === "error") {
        (s[`on${ev.type}`] as ((e: Event) => void) | null)?.call(target, ev);
      }
    };
    s.close = () => {
      if (s.readyState === 2) return;
      s.readyState = 2;
      port.postMessage({ id, kind: "abort" });
    };
    const flush = () => {
      let at: number;
      while ((at = buffer.indexOf("\n\n")) >= 0) {
        const block = buffer.slice(0, at);
        buffer = buffer.slice(at + 2);
        let type = "message";
        const data: string[] = [];
        for (const line of block.split("\n")) {
          if (line.startsWith(":")) continue;
          if (line.startsWith("event:")) type = line.slice(6).trim();
          else if (line.startsWith("data:")) data.push(line.slice(5).replace(/^ /, ""));
        }
        if (data.length > 0) emit(new MessageEvent(type, { data: data.join("\n") }));
      }
    };
    id = send(
      url,
      {},
      {
        head: () => {
          if (s.readyState === 2) return;
          s.readyState = 1;
          emit(new Event("open"));
        },
        chunk: (d) => {
          if (s.readyState === 2) return;
          buffer += d;
          flush();
        },
        end: () => {
          if (s.readyState === 2) return;
          s.readyState = 2;
          emit(new Event("error"));
        },
      },
    );
    return target;
  }

  return { fetch: doFetch, eventSource };
}
