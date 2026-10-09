type In =
  | { id: number; kind: "request"; method: string; url: string; headers: [string, string][]; body: string | null }
  | { id: number; kind: "abort" };

// answers the UI's requests posted over a port with a workspace's router, streaming bodies so event streams work
export function expose(port: MessagePort, dispatch: (r: Request) => Promise<Response>): () => void {
  const open = new Map<number, AbortController>();
  port.onmessage = async (e: MessageEvent<In>) => {
    const m = e.data;
    if (m.kind === "abort") {
      open.get(m.id)?.abort();
      return;
    }
    const ac = new AbortController();
    open.set(m.id, ac);
    let headSent = false;
    try {
      const res = await dispatch(
        new Request(new URL(m.url, "http://worker"), {
          method: m.method,
          headers: m.headers,
          body: m.body,
          signal: ac.signal,
        }),
      );
      port.postMessage({ id: m.id, kind: "head", status: res.status, headers: [...res.headers] });
      headSent = true;
      if (res.body) {
        // one decoder per body: a character split across chunks must not mix with another response's bytes
        const decoder = new TextDecoder();
        const reader = res.body.getReader();
        ac.signal.addEventListener("abort", () => void reader.cancel(), { once: true });
        for (;;) {
          const { done, value } = await reader.read();
          if (done) break;
          port.postMessage({ id: m.id, kind: "chunk", data: decoder.decode(value, { stream: true }) });
        }
        const rest = decoder.decode();
        if (rest) port.postMessage({ id: m.id, kind: "chunk", data: rest });
      }
    } catch (err) {
      // once the head is out the body may be an event stream, so a failure there only ends it
      if (!ac.signal.aborted && !headSent) {
        port.postMessage({ id: m.id, kind: "head", status: 500, headers: [["content-type", "application/json"]] });
        port.postMessage({ id: m.id, kind: "chunk", data: JSON.stringify({ error: String(err) }) });
      }
    } finally {
      open.delete(m.id);
      port.postMessage({ id: m.id, kind: "end" });
    }
  };
  port.start?.();
  return () => {
    for (const ac of open.values()) ac.abort();
    port.onmessage = null;
  };
}
