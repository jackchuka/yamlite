import type { IncomingMessage, ServerResponse } from "node:http";
import pkg from "../../../package.json" with { type: "json" };
import { AgentStartError } from "../../agent/host.ts";
import { handleMcp } from "../../agent/mcp.ts";
import { agentTools } from "../../agent/tools.ts";
import type { ApiContext } from "../context.ts";
import { HttpError, readJson, Reply, sendJson, STREAMED } from "../http.ts";
import { objectBody } from "../write.ts";
import type { Routes } from "./index.ts";

const { version } = pkg;
const KEEPALIVE_MS = 15_000;

const host = (ctx: ApiContext) => {
  if (!ctx.agent) throw new HttpError(404, "no agent is available");
  return ctx.agent;
};

export const agentRoutes: Routes = (router, ctx) => {
  router.add("POST", "/api/agent/conversations", async ({ body }) => {
    const agent = objectBody(body, "body").agent;
    if (typeof agent !== "string") throw new HttpError(400, "agent is required");
    try {
      const c = await host(ctx).start(agent);
      return new Reply(201, { id: c.id });
    } catch (e) {
      if (e instanceof AgentStartError) throw new HttpError(502, e.message, { code: e.code });
      throw e;
    }
  });

  router.add("GET", "/api/agent/conversations", () => ({ conversations: host(ctx).list() }));

  // works for stopped conversations too: replays the history and stays open for a resumed turn
  router.add("GET", "/api/agent/conversations/:id/events", ({ params, res }) => {
    const c = host(ctx).get(params.id as string);
    if (!c) throw new HttpError(404, "unknown conversation");
    res.writeHead(200, {
      "content-type": "text/event-stream; charset=utf-8",
      "cache-control": "no-store",
      connection: "keep-alive",
    });
    res.flushHeaders();
    const send = (e: { type: string }) => {
      if (res.writableEnded) return;
      res.write(`event: agent\ndata: ${JSON.stringify(e)}\n\n`);
      if (e.type === "closed") res.end();
    };
    for (const e of c.events) send(e);
    const off = res.writableEnded ? () => {} : c.subscribe(send);
    const ping = setInterval(() => res.write(": ping\n\n"), KEEPALIVE_MS);
    res.on("close", () => {
      clearInterval(ping);
      off();
    });
    return STREAMED;
  });

  router.add("POST", "/api/agent/conversations/:id/prompt", ({ params, body }) => {
    const text = objectBody(body, "body").text;
    if (typeof text !== "string" || text.trim() === "") throw new HttpError(400, "text is required");
    host(ctx).prompt(params.id as string, text);
    return new Reply(202, { ok: true });
  });

  router.add("POST", "/api/agent/conversations/:id/cancel", async ({ params }) => {
    await host(ctx).cancel(params.id as string);
    return { ok: true };
  });

  router.add("DELETE", "/api/agent/conversations/:id", async ({ params }) => {
    await host(ctx).end(params.id as string);
    return { ok: true };
  });

  router.add("GET", "/api/agent/proposals", () => ({ proposals: ctx.proposals.pending() }));
  router.add("POST", "/api/agent/proposals/:id/apply", ({ params }) => {
    const id = params.id as string;
    return ctx.proposals.get(id)?.git ? ctx.proposals.applyGit(id) : ctx.proposals.apply(id);
  });
  router.add("POST", "/api/agent/proposals/:id/discard", ({ params }) => ctx.proposals.discard(params.id as string));
};

// the agent's door into yamlite: authenticated by its conversation's token, not the UI's
export function mcpEndpoint(ctx: ApiContext) {
  return async (req: IncomingMessage, res: ServerResponse): Promise<void> => {
    if (req.method !== "POST") {
      res.writeHead(405, { allow: "POST" });
      res.end();
      return;
    }
    const bearer = /^Bearer (.+)$/.exec(req.headers.authorization ?? "")?.[1];
    const c = bearer ? ctx.agent?.byToken(bearer) : undefined;
    if (!c) {
      sendJson(res, 401, { error: "unknown or ended conversation" });
      return;
    }
    let body: unknown;
    try {
      body = await readJson(req);
    } catch (e) {
      sendJson(res, e instanceof HttpError ? e.status : 400, { error: e instanceof Error ? e.message : String(e) });
      return;
    }
    const out = await handleMcp(body, agentTools(ctx, c.id), version);
    if (out === null) {
      res.writeHead(202);
      res.end();
    } else sendJson(res, 200, out);
  };
}
