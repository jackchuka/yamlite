import { expect, test } from "vitest";

test("yamlite's core syncs YAML and SQLite in a browser worker, with the database in OPFS", async () => {
  const worker = new Worker(new URL("./core.worker.ts", import.meta.url), { type: "module" });
  // oxlint-disable-next-line typescript/no-explicit-any
  const out = await new Promise<{ result?: any; error?: string }>((done) => {
    worker.onmessage = (e) => done(e.data);
    worker.onerror = (e) => done({ error: e.message || "worker failed to start" });
    worker.postMessage("run");
  });
  worker.terminate();
  expect(out.error).toBeUndefined();
  const r = out.result;
  console.log(JSON.stringify({ bulkMs: r.bulkMs, queryMs: r.queryMs, opfsFiles: r.opfsFiles, checkOk: r.checkOk }));
  expect(r.first).toEqual(expect.arrayContaining([expect.objectContaining({ table: "tasks", ok: true, toDb: 1 })]));
  expect(r.before).toEqual([["a", "A"]]);
  expect(r.fileA).toBe("title: B\ndone: false # keep me\n");
  expect(r.fileN).toContain("title: New");
  expect(r.count).toEqual([[250n]]);
  expect(r.watched).toEqual([["W"]]);
  expect(r.opfsFiles).toContain("/data/.yamlite/db.sqlite");
}, 120_000);
