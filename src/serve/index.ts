import { randomBytes } from "node:crypto";
import { createServer, type Server as HttpServer } from "node:http";
import type { AddressInfo } from "node:net";
import { fileURLToPath } from "node:url";
import { type AgentInfo, detectAgents } from "../agent/detect.ts";
import type { GitDriver } from "../git/driver.ts";
import type { Repo } from "../git/repo.ts";
import type { WatchOptions } from "../watch.ts";
import type { ApiContext } from "./context.ts";
import { createHandler } from "./http.ts";
import { type AccessPolicy, isLoopback, loopbackHosts } from "./security.ts";
import { createWorkspace } from "./workspace.ts";

export interface ServeOptions {
  root: string;
  db?: string;
  port?: number;
  host?: string;
  uiDir?: string;
  watch?: WatchOptions;
  agent?: boolean;
  agents?: AgentInfo[];
  // skips gh detection; null means no gh
  gh?: string | null;
  // absent: the local driver, built from the gh probe
  driver?: (repo: Repo) => GitDriver;
}

export interface Server {
  readonly url: string;
  readonly port: number;
  readonly token: string;
  // for tests and embedding
  readonly context: ApiContext;
  close(): Promise<void>;
}

// the bundle lives in dist/, next to dist/ui/
const DEFAULT_UI = fileURLToPath(new URL("./ui/", import.meta.url));

const urlHostOf = (h: string) => (h.includes(":") ? `[${h}]` : h);

function listen(server: HttpServer, port: number, host: string): Promise<number> {
  return new Promise((done, fail) => {
    server.once("error", (e: NodeJS.ErrnoException) => {
      fail(e.code === "EADDRINUSE" ? new Error(`port ${port} is already in use; pick another one with --port`) : e);
    });
    server.listen(port, host, () => done((server.address() as AddressInfo).port));
  });
}

export async function serve(opts: ServeOptions): Promise<Server> {
  const host = opts.host ?? "127.0.0.1";
  let port = 0;
  let mcpHost = "127.0.0.1";
  const w = await createWorkspace({
    root: opts.root,
    db: opts.db,
    watch: opts.watch,
    agents: opts.agent === false ? [] : (opts.agents ?? detectAgents()),
    mcpUrl: () => `http://${mcpHost}:${port}/mcp`,
    gh: opts.gh,
    driver: opts.driver,
  });
  try {
    const token = randomBytes(24).toString("hex");
    let policy: AccessPolicy = { token, allowedHosts: new Set() };
    const http = createServer(createHandler(w.router, () => policy, opts.uiDir ?? DEFAULT_UI, w.mcp));
    port = await listen(http, opts.port ?? 4610, host);
    const bound = (http.address() as AddressInfo).address;
    mcpHost = bound === "0.0.0.0" || bound === "::" ? "127.0.0.1" : urlHostOf(bound);
    policy = { token, allowedHosts: isLoopback(host) ? loopbackHosts(port) : null };
    let closing: Promise<void> | undefined;
    return {
      url: `http://${urlHostOf(host)}:${port}/?token=${token}`,
      port,
      token,
      context: w.context,
      close() {
        closing ??= (async () => {
          try {
            http.closeAllConnections();
            await new Promise<void>((done) => http.close(() => done()));
          } finally {
            await w.close();
          }
        })();
        return closing;
      },
    };
  } catch (e) {
    await w.close();
    throw e;
  }
}
