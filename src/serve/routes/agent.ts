import type { Conversation } from "../../agent/host.ts";
import type { ApiContext } from "../context.ts";
import { HttpError, Reply } from "../http.ts";
import { objectBody } from "../write.ts";
import type { Routes } from "./index.ts";

const KEEPALIVE_MS = 15_000;

const encoder = new TextEncoder();

function agentStream(c: Conversation, signal: AbortSignal): ReadableStream<Uint8Array> {
  let off = () => {};
  let ping: ReturnType<typeof setInterval> | undefined;
  let done = false;
  let ctrl!: ReadableStreamDefaultController<Uint8Array>;
  const stop = () => {
    if (done) return;
    done = true;
    clearInterval(ping);
    off();
    try {
      ctrl.close();
    } catch {}
  };
  return new ReadableStream<Uint8Array>({
    start: (k) => {
      ctrl = k;
      const send = (e: { type: string }) => {
        if (done) return;
        k.enqueue(encoder.encode(`event: agent\ndata: ${JSON.stringify(e)}\n\n`));
        if (e.type === "closed") stop();
      };
      for (const e of c.events) send(e);
      if (done) return;
      off = c.subscribe(send);
      ping = setInterval(() => k.enqueue(encoder.encode(": ping\n\n")), KEEPALIVE_MS);
      signal.addEventListener("abort", stop, { once: true });
    },
    cancel: stop,
  });
}

const host = (ctx: ApiContext) => {
  if (!ctx.agent) throw new HttpError(404, "no agent is available");
  return ctx.agent;
};

export const agentRoutes: Routes = (router, ctx) => {
  router.add("POST", "/api/agent/conversations", ({ body }) => {
    const { provider, model, apiKey } = objectBody(body, "body");
    const c = host(ctx).start({ provider, model, apiKey });
    return new Reply(201, { id: c.id });
  });

  router.add("GET", "/api/agent/conversations", () => ({ conversations: host(ctx).list() }));

  // works for stopped conversations too: replays the history and stays open for a resumed turn
  router.add("GET", "/api/agent/conversations/:id/events", ({ params, signal }) => {
    const c = host(ctx).get(params.id as string);
    if (!c) throw new HttpError(404, "unknown conversation");
    return new Response(agentStream(c, signal), {
      headers: {
        "content-type": "text/event-stream; charset=utf-8",
        "cache-control": "no-store",
        connection: "keep-alive",
      },
    });
  });

  router.add("POST", "/api/agent/conversations/:id/prompt", ({ params, body }) => {
    const text = objectBody(body, "body").text;
    if (typeof text !== "string" || text.trim() === "") throw new HttpError(400, "text is required");
    host(ctx).prompt(params.id as string, text);
    return new Reply(202, { ok: true });
  });

  router.add("POST", "/api/agent/conversations/:id/cancel", ({ params }) => {
    host(ctx).cancel(params.id as string);
    return { ok: true };
  });

  router.add("DELETE", "/api/agent/conversations/:id", ({ params }) => {
    host(ctx).end(params.id as string);
    return { ok: true };
  });

  router.add("GET", "/api/agent/proposals", () => ({ proposals: ctx.proposals.pending() }));
  router.add("POST", "/api/agent/proposals/:id/apply", ({ params }) => {
    const id = params.id as string;
    const p = ctx.proposals.get(id);
    if (p?.git && !ctx.git?.steps) throw new HttpError(404, "git steps are not available here");
    return p?.git ? ctx.proposals.applyGit(id) : ctx.proposals.apply(id);
  });
  router.add("POST", "/api/agent/proposals/:id/discard", ({ params }) => ctx.proposals.discard(params.id as string));
};
