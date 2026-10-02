import { request } from "node:http";
import { join } from "node:path";
import { type ServeOptions, serve } from "../../src/serve/index.ts";
import { dataRoot, tmpRoot, write } from "../helpers.ts";

export const fast = { pollMs: 50, debounceMs: 50 };

export async function startServe(
  files: Record<string, string> = {},
  config?: string,
  opts: Partial<ServeOptions> = {},
) {
  const root = opts.root ?? dataRoot();
  if (config) write(join(root, "yamlite.yaml"), config);
  for (const [path, content] of Object.entries(files)) write(join(root, path), content);
  const uiDir = tmpRoot();
  write(join(uiDir, "index.html"), "<!doctype html><title>yamlite</title>");
  write(join(uiDir, "assets/app.js"), "console.log(1)");
  const s = await serve({ port: 0, uiDir, watch: fast, ...opts, root });
  const base = `http://127.0.0.1:${s.port}`;
  const cookie = `yamlite_token=${s.token}`;
  const api = async (path: string, init: { method?: string; body?: unknown } = {}) => {
    const res = await fetch(base + path, {
      method: init.method ?? "GET",
      headers: { cookie, "content-type": "application/json" },
      body: init.body === undefined ? undefined : JSON.stringify(init.body),
    });
    const text = await res.text();
    return { status: res.status, body: text ? (JSON.parse(text) as any) : null };
  };
  return { root, s, base, cookie, api, db: join(root, ".yamlite", "db.sqlite"), stateDir: join(root, ".yamlite") };
}

export type Served = Awaited<ReturnType<typeof startServe>>;

// node:http instead of fetch, so that Host and Origin can be set freely
export function raw(
  port: number,
  opts: { method?: string; path: string; headers?: Record<string, string> },
): Promise<{ status: number; headers: Record<string, string | string[] | undefined>; body: string }> {
  return new Promise((resolve, reject) => {
    const req = request(
      { host: "127.0.0.1", port, method: opts.method ?? "GET", path: opts.path, headers: opts.headers },
      (res) => {
        let body = "";
        res.setEncoding("utf8");
        res.on("data", (chunk: string) => (body += chunk));
        res.on("end", () => resolve({ status: res.statusCode ?? 0, headers: res.headers, body }));
      },
    );
    req.on("error", reject);
    req.end();
  });
}

export async function events(t: Served) {
  const res = await fetch(`${t.base}/api/events`, { headers: { cookie: t.cookie } });
  if (!res.body) throw new Error("no SSE body");
  const reader = res.body.pipeThrough(new TextDecoderStream()).getReader();
  const got: Array<{ type: string } & Record<string, any>> = [];
  let buffer = "";
  const pump = (async () => {
    for (;;) {
      const { value, done } = await reader.read();
      if (done) return;
      buffer += value;
      for (let i = buffer.indexOf("\n\n"); i >= 0; i = buffer.indexOf("\n\n")) {
        const chunk = buffer.slice(0, i);
        buffer = buffer.slice(i + 2);
        const type = /^event: (.*)$/m.exec(chunk)?.[1];
        const data = /^data: (.*)$/m.exec(chunk)?.[1];
        if (type && data) got.push({ type, ...(JSON.parse(data) as object) });
      }
    }
  })().catch(() => {});
  return {
    got,
    async close() {
      await reader.cancel().catch(() => {});
      await pump;
    },
  };
}

export async function waitForAsync(cond: () => Promise<boolean>, timeoutMs = 5000): Promise<void> {
  const start = Date.now();
  while (!(await cond())) {
    if (Date.now() - start > timeoutMs) throw new Error("waitForAsync timed out");
    await new Promise((r) => setTimeout(r, 25));
  }
}
