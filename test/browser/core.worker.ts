// runs yamlite's core in a dedicated worker, where OPFS sync access handles exist
import "../../src/browser/globals.ts";

let stage = "start";
async function run() {
  const fs = await import("node:fs");
  stage = "import core";
  const { init, open, check, query } = await import("../../src/index.ts");
  stage = "sqlite-wasm and OPFS";
  const sqlite = await import("node:sqlite");
  stage = "sync";
  const { opfs } = sqlite as unknown as {
    opfs: { getFileNames(): string[]; wipeFiles(): Promise<void>; unlink(name: string): boolean };
  };
  await opfs.wipeFiles();
  const shim = fs as unknown as {
    onRemove(fn: (path: string) => void): void;
    external(fn: (path: string) => boolean): void;
  };
  shim.external((path) => opfs.getFileNames().includes(path));
  // removing a folder in the working copy also removes the database files under it
  shim.onRemove((path) => {
    for (const name of opfs.getFileNames()) {
      if (name === path || name.startsWith(`${path}/`) || name.startsWith(`${path}-`)) opfs.unlink(name);
    }
  });

  const root = "/data";
  const db = `${root}/.yamlite/db.sqlite`;
  fs.mkdirSync(`${root}/tasks`, { recursive: true });
  fs.writeFileSync(`${root}/tasks/a.yaml`, "title: A\ndone: false # keep me\n");
  fs.writeFileSync(`${root}/people.yaml`, "- id: p1\n  name: Ann\n");
  init({ root });

  const y = await open({ root });
  const first = await y.sync();
  const read = () => query({ root, db, sql: "SELECT id, title FROM tasks ORDER BY id" });
  const before = (await read()).rows;

  const conn = new sqlite.DatabaseSync(db);
  conn.exec("UPDATE tasks SET title = 'B' WHERE id = 'a'; INSERT INTO tasks (id, title) VALUES ('n', 'New')");
  conn.close();
  const back = await y.sync();
  const fileA = fs.readFileSync(`${root}/tasks/a.yaml`, "utf8");
  const fileN = fs.readFileSync(`${root}/tasks/n.yaml`, "utf8");

  for (let i = 0; i < 500; i++)
    fs.writeFileSync(`${root}/tasks/bulk-${i}.yaml`, `title: T${i}\ndone: ${i % 2 === 0}\n`);
  let started = performance.now();
  await y.sync();
  const bulkMs = Math.round(performance.now() - started);
  started = performance.now();
  const count = (await query({ root, db, sql: "SELECT count(*) AS n FROM tasks WHERE done" })).rows;
  const queryMs = Math.round(performance.now() - started);

  const synced = new Promise<void>((done) => {
    y.watch(
      { onSync: (r) => r.table === "tasks" && r.changes.some((c) => c.key === "watched") && done() },
      { debounceMs: 10 },
    );
  });
  fs.writeFileSync(`${root}/tasks/watched.yaml`, "title: W\n");
  await synced;
  const watched = (await query({ root, db, sql: "SELECT title FROM tasks WHERE id = 'watched'" })).rows;

  const checked = await check({ root });
  await y.close();
  return {
    first: first.map((t) => ({ table: t.table, ok: t.ok, toDb: t.toDb })),
    before,
    back: back.map((t) => ({ table: t.table, ok: t.ok })),
    fileA,
    fileN,
    count,
    bulkMs,
    queryMs,
    watched,
    checkOk: checked.ok,
    opfsFiles: opfs.getFileNames(),
  };
}

self.onmessage = async () => {
  try {
    postMessage({ result: await run() });
  } catch (e) {
    postMessage({ error: e instanceof Error ? `[${stage}] ${e.message}\n${e.stack}` : String(e) });
  }
};
