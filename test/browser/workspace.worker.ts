// runs a whole workspace in a dedicated worker, served over a MessagePort
import "../../src/browser/globals.ts";

type Opfs = { getFileNames(): string[]; wipeFiles(): Promise<void>; unlink(name: string): boolean };

self.onmessage = async (e: MessageEvent<{ port: MessagePort } | { read: string }>) => {
  const fs = await import("node:fs");
  if ("read" in e.data) {
    postMessage({ text: fs.readFileSync(e.data.read, "utf8") });
    return;
  }
  const { init, createWorkspace } = await import("../../src/core.ts");
  const { expose } = await import("../../src/browser/expose.ts");
  const { opfs } = (await import("node:sqlite")) as unknown as { opfs: Opfs };
  await opfs.wipeFiles();
  const shim = fs as unknown as {
    onRemove(fn: (path: string) => void): void;
    external(fn: (path: string) => boolean): void;
  };
  shim.external((path) => opfs.getFileNames().includes(path));
  shim.onRemove((path) => {
    for (const name of opfs.getFileNames()) {
      if (name === path || name.startsWith(`${path}/`) || name.startsWith(`${path}-`)) opfs.unlink(name);
    }
  });
  fs.mkdirSync("/data/tasks", { recursive: true });
  fs.writeFileSync("/data/tasks/a.yaml", "title: A # keep me\ndone: false\n");
  init({ root: "/data" });
  const ws = await createWorkspace({
    root: "/data",
    agents: [],
    mcpUrl: () => "",
    git: null,
    watch: { debounceMs: 10 },
  });
  expose(e.data.port, (r) => ws.router.dispatch(r));
  postMessage({ ready: true });
};
