import { expect, test } from "vitest";
import { createWorkerTransport } from "../../ui/src/lib/workerTransport.ts";

const expected = "title: A # keep me\ndone: true\n";

test("the UI's requests reach a workspace in a worker, and edits reach the YAML file", async () => {
  const worker = new Worker(new URL("./workspace.worker.ts", import.meta.url), { type: "module" });
  let es: ReturnType<ReturnType<typeof createWorkerTransport>["eventSource"]> | undefined;
  try {
    const { port1, port2 } = new MessageChannel();
    const next = () => new Promise<any>((r) => (worker.onmessage = (e) => r(e.data)));
    const ready = next();
    worker.postMessage({ port: port2 }, [port2]);
    expect(await ready).toEqual({ ready: true });
    const t = createWorkerTransport(port1);

    es = t.eventSource("/api/events");
    await new Promise<void>((done) => es!.addEventListener("hello", () => done(), { once: true }));
    es.close();
    es = undefined;

    const meta = await (await t.fetch("/api/meta")).json();
    expect(meta.tables.map((x: { name: string }) => x.name)).toEqual(["tasks"]);

    const record = await (await t.fetch("/api/tables/tasks/rows/a")).json();
    const res = await t.fetch("/api/tables/tasks/rows/a", {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ values: { done: true }, base: record.row }),
    });
    expect(res.status).toBe(200);

    const deadline = Date.now() + 5000;
    let text = "";
    while (text !== expected && Date.now() < deadline) {
      const read = next();
      worker.postMessage({ read: "/data/tasks/a.yaml" });
      text = (await read).text;
      if (text !== expected) await new Promise((r) => setTimeout(r, 25));
    }
    expect(text).toBe(expected);
  } finally {
    es?.close();
    worker.terminate();
  }
});
