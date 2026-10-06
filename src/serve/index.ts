import { randomBytes } from "node:crypto";
import { createServer, type Server as HttpServer } from "node:http";
import type { AddressInfo } from "node:net";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { detectAgents, type AgentInfo } from "../agent/detect.ts";
import { AgentHost } from "../agent/host.ts";
import { ProposalStore } from "../agent/proposals.ts";
import { configPath, resolveConfig } from "../config.ts";
import { open } from "../index.ts";
import { Store } from "../store.ts";
import type { WatchOptions } from "../watch.ts";
import type { ApiContext } from "./context.ts";
import { EventHub } from "./events.ts";
import { PageSql } from "./pagesql.ts";
import { PageWatch } from "./pagewatch.ts";
import { createHandler, Router } from "./http.ts";
import { mcpEndpoint } from "./routes/agent.ts";
import { ROUTES } from "./routes/index.ts";
import { createTable } from "./routes/tables.ts";
import { type AccessPolicy, isLoopback, loopbackHosts } from "./security.ts";

export interface ServeOptions {
  root: string;
  db?: string;
  port?: number;
  host?: string;
  uiDir?: string;
  watch?: WatchOptions;
  agent?: boolean;
  agents?: AgentInfo[];
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
  const config = resolveConfig({ root: opts.root, db: opts.db });
  const configFile = configPath(opts.root);
  if (configFile === null) throw new Error(`no yamlite.yaml in ${opts.root}; run yamlite init first`);
  const y = await open({ root: opts.root, db: opts.db });
  let store: Store | undefined;
  let dry: Store | undefined;
  let pageSql: PageSql | undefined;
  let pageWatch: PageWatch | undefined;
  try {
    const hub = new EventHub();
    pageWatch = new PageWatch((pages) => hub.pagesChanged(pages), opts.watch?.debounceMs);
    const pages = pageWatch;
    const watcher = y.watch(
      {
        ...hub.handlers,
        onReload: (tables) => {
          hub.handlers.onReload?.(tables);
          void pages.update(y.pages);
        },
      },
      opts.watch,
    );
    await watcher.ready;
    await pages.update(y.pages);
    store = new Store(config.db);
    pageSql = new PageSql(config.db);
    dry = new Store(config.db);
    const proposals = new ProposalStore(
      {
        store,
        dry,
        tables: () => y.tables,
        createTable: (t) => {
          createTable(ctx, { ...t });
        },
      },
      (p) => ctx.agent?.publish(p.conversationId, { type: "proposal", proposal: p }),
    );
    const ctx: ApiContext = {
      y,
      store,
      pageSql,
      root: resolve(opts.root),
      stateDir: config.stateDir,
      configFile,
      dbPath: config.db,
      hub,
      proposals,
      agent: null,
    };
    const router = new Router();
    for (const routes of ROUTES) routes(router, ctx);
    const token = randomBytes(24).toString("hex");
    let policy: AccessPolicy = { token, allowedHosts: new Set() };
    let port = 0;
    const agents = opts.agent === false ? [] : (opts.agents ?? detectAgents());
    let mcpHost = "127.0.0.1";
    if (agents.length > 0) {
      ctx.agent = new AgentHost({
        root: ctx.root,
        agents,
        mcpUrl: () => `http://${mcpHost}:${port}/mcp`,
        feedback: (id) => ctx.proposals.takeFeedback(id),
      });
    }
    const http = createServer(createHandler(router, () => policy, opts.uiDir ?? DEFAULT_UI, mcpEndpoint(ctx)));
    port = await listen(http, opts.port ?? 4610, host);
    const bound = (http.address() as AddressInfo).address;
    mcpHost = bound === "0.0.0.0" || bound === "::" ? "127.0.0.1" : urlHostOf(bound);
    policy = { token, allowedHosts: isLoopback(host) ? loopbackHosts(port) : null };
    const urlHost = urlHostOf(host);
    const ui = store;
    const pq = pageSql;
    const dr = dry;
    let closing: Promise<void> | undefined;
    return {
      url: `http://${urlHost}:${port}/?token=${token}`,
      port,
      token,
      context: ctx,
      close() {
        closing ??= (async () => {
          try {
            await ctx.agent?.close();
            await pages.close();
            hub.close();
            http.closeAllConnections();
            await new Promise<void>((done) => http.close(() => done()));
          } finally {
            try {
              try {
                pq.close();
              } finally {
                try {
                  dr.close();
                } finally {
                  ui.close();
                }
              }
            } finally {
              await y.close();
            }
          }
        })();
        return closing;
      },
    };
  } catch (e) {
    await pageWatch?.close();
    pageSql?.close();
    dry?.close();
    store?.close();
    await y.close();
    throw e;
  }
}
