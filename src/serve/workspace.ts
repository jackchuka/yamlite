import { resolve } from "node:path";
import { type AgentInfo, which } from "../agent/detect.ts";
import { AgentHost, GIT_DONE, GIT_NOTE } from "../agent/host.ts";
import { ProposalStore } from "../agent/proposals.ts";
import { configPath, resolveConfig } from "../config.ts";
import { type GitDriver, localDriver } from "../git/driver.ts";
import { findRepo, ghReady } from "../git/repo.ts";
import { runSteps } from "../git/steps.ts";
import { fileDiff, recordHistory } from "../githistory.ts";
import { open } from "../index.ts";
import { Store } from "../store.ts";
import type { WatchOptions } from "../watch.ts";
import type { ApiContext } from "./context.ts";
import { EventHub } from "./events.ts";
import { type McpHandler, Router } from "./http.ts";
import { PageSql } from "./pagesql.ts";
import { PageWatch } from "./pagewatch.ts";
import { mcpEndpoint } from "./routes/agent.ts";
import { ROUTES } from "./routes/index.ts";
import { createTable } from "./routes/tables.ts";
import { assertSynced } from "./write.ts";

export interface WorkspaceOptions {
  root: string;
  db?: string;
  watch?: WatchOptions;
  agents: AgentInfo[];
  // the URL agents reach this workspace's MCP endpoint at; read when an agent starts
  mcpUrl: () => string;
  // absent: the local repository, if any, with the gh probe; null: no git
  git?: GitDriver | null;
  // skips gh detection; null means no gh
  gh?: string | null;
}

// one data root's server: everything but the listener and the access check
export interface Workspace {
  readonly context: ApiContext;
  readonly router: Router;
  readonly mcp: McpHandler;
  close(): Promise<void>;
}

export async function createWorkspace(o: WorkspaceOptions): Promise<Workspace> {
  const config = resolveConfig({ root: o.root, db: o.db });
  const configFile = configPath(o.root);
  if (configFile === null) throw new Error(`no yamlite.yaml in ${o.root}; run yamlite init first`);
  const y = await open({ root: o.root, db: o.db });
  let store: Store | undefined;
  let dry: Store | undefined;
  let pageSql: PageSql | undefined;
  let pageWatch: PageWatch | undefined;
  try {
    const hub = new EventHub();
    pageWatch = new PageWatch((pages) => hub.pagesChanged(pages), o.watch?.debounceMs);
    const pages = pageWatch;
    const watcher = y.watch(
      {
        ...hub.handlers,
        onReload: (tables) => {
          hub.handlers.onReload?.(tables);
          void pages.update(y.pages);
        },
      },
      o.watch,
    );
    await watcher.ready;
    await pages.update(y.pages);
    store = new Store(config.db);
    pageSql = new PageSql(config.db);
    dry = new Store(config.db);
    let probed: Promise<string | null> | undefined;
    const gh = () =>
      (probed ??= o.gh !== undefined ? Promise.resolve(o.gh) : ghReady().then((ok) => (ok ? which("gh") : null)));
    const detectLocal = async () => {
      const repo = await findRepo(o.root);
      return repo ? localDriver(repo, resolve(o.root), gh) : null;
    };
    const git = o.git !== undefined ? o.git : await detectLocal();
    const history = git ?? (o.git === undefined ? { history: recordHistory, fileDiff } : null);
    const repo = git?.steps ? git.repo : null;
    const proposals = new ProposalStore(
      {
        store,
        dry,
        tables: () => y.tables,
        createTable: (t) => {
          createTable(ctx, { ...t });
        },
        runGit:
          git && repo
            ? async (steps, startBranch, onProgress) => {
                // UI edits reach the files before git reads them
                assertSynced(await y.sync(), "could not write the latest edits to files for", "; nothing was run");
                return runSteps(repo, steps, {
                  driver: git,
                  expectBranch: startBranch,
                  // git wrote these files, so a branch with fewer records is not a wipe
                  afterTreeChange: async () =>
                    assertSynced(await y.sync({ force: true }), "the database could not follow the files for"),
                  onProgress,
                });
              }
            : undefined,
      },
      (p) => {
        ctx.agent?.publish(p.conversationId, { type: "proposal", proposal: p });
        if (p.git && (p.status === "applied" || p.status === "failed")) ctx.agent?.notify(p.conversationId, GIT_DONE);
      },
    );
    const ctx: ApiContext = {
      y,
      store,
      pageSql,
      root: resolve(o.root),
      stateDir: config.stateDir,
      configFile,
      dbPath: config.db,
      hub,
      proposals,
      agent: null,
      git,
      history,
    };
    const router = new Router();
    for (const routes of ROUTES) routes(router, ctx);
    if (o.agents.length > 0) {
      ctx.agent = new AgentHost({
        root: ctx.root,
        agents: o.agents,
        mcpUrl: o.mcpUrl,
        notes: git?.repo ? [GIT_NOTE] : [],
        feedback: (id) => ctx.proposals.takeFeedback(id),
      });
    }
    const ui = store;
    const pq = pageSql;
    const dr = dry;
    let closing: Promise<void> | undefined;
    return {
      context: ctx,
      router,
      mcp: mcpEndpoint(ctx),
      close() {
        closing ??= (async () => {
          try {
            await ctx.agent?.close();
            await pages.close();
            hub.close();
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
