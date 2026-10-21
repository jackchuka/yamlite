import {
  APICallError,
  generateText,
  jsonSchema,
  type ModelMessage,
  Output,
  RetryError,
  streamText,
  type TextStreamPart,
  type ToolSet,
} from "ai";
import { PAGE_AI_MAX_TOKENS } from "../../pages/access.ts";
import { HttpError } from "../http.ts";
import { objectBody } from "../write.ts";
import type { Routes } from "./index.ts";
import { pageSpec } from "./pages.ts";

interface PageAsk {
  system?: string;
  prompt: string | ModelMessage[];
  schema?: Record<string, unknown>;
  model?: string;
  maxOutputTokens?: number;
}

const isMap = (v: unknown): v is Record<string, unknown> => v !== null && typeof v === "object" && !Array.isArray(v);

function readAsk(body: unknown, streaming: boolean): PageAsk {
  const b = objectBody(body, "body");
  if (b.apiKey !== undefined) throw new HttpError(400, "pages cannot send API keys");
  const { system, prompt, schema, model, maxOutputTokens } = b;
  if (system !== undefined && typeof system !== "string") throw new HttpError(400, "system must be a string");
  if (model !== undefined && typeof model !== "string") throw new HttpError(400, "model must be a string");
  if (schema !== undefined && streaming) throw new HttpError(400, "schema is not supported when streaming");
  if (schema !== undefined && !isMap(schema)) throw new HttpError(400, "schema must be an object");
  if (maxOutputTokens !== undefined && !(Number.isInteger(maxOutputTokens) && (maxOutputTokens as number) > 0))
    throw new HttpError(400, "maxOutputTokens must be a positive integer");
  return {
    system,
    prompt: readPrompt(prompt),
    schema,
    model,
    maxOutputTokens: maxOutputTokens as number | undefined,
  };
}

function readPrompt(prompt: unknown): string | ModelMessage[] {
  if (typeof prompt === "string") {
    if (prompt.trim() === "") throw new HttpError(400, "prompt is required");
    return prompt;
  }
  const bad = () =>
    new HttpError(400, "prompt must be a string or a list of { role: user | assistant, content: string }");
  if (!Array.isArray(prompt) || prompt.length === 0) throw bad();
  return prompt.map((m): ModelMessage => {
    if (!isMap(m) || (m.role !== "user" && m.role !== "assistant") || typeof m.content !== "string") throw bad();
    return { role: m.role, content: m.content };
  });
}

function retryAfterSeconds(value: string | undefined): number | undefined {
  if (!value) return undefined;
  const seconds = Number(value);
  if (Number.isFinite(seconds) && seconds >= 0) return Math.ceil(seconds);
  const at = Date.parse(value);
  return Number.isNaN(at) ? undefined : Math.max(0, Math.ceil((at - Date.now()) / 1000));
}

// a host's AI proxy answers 422 with an error of type no_key, in the Anthropic or the OpenAI shape
function isNoKey(body: string | undefined): boolean {
  try {
    const error = (JSON.parse(body ?? "") as { error?: { type?: unknown; code?: unknown } }).error;
    return error?.type === "no_key" || error?.code === "no_key";
  } catch {
    return false;
  }
}

function modelError(e: unknown, provider: string): HttpError {
  const cause = RetryError.isInstance(e) ? e.lastError : e;
  if (cause instanceof HttpError) return cause;
  const message = cause instanceof Error ? cause.message : String(cause);
  if (APICallError.isInstance(cause)) {
    if (cause.statusCode === 429) {
      const retryAfter = retryAfterSeconds(cause.responseHeaders?.["retry-after"]);
      return new HttpError(429, message, { provider, ...(retryAfter === undefined ? {} : { retryAfter }) });
    }
    if (cause.statusCode === 422 && isNoKey(cause.responseBody))
      return new HttpError(503, "no AI key is configured on this host", { code: "no_key" });
  }
  return new HttpError(502, message, { provider });
}

const KEEPALIVE_MS = 15_000;

const encoder = new TextEncoder();
const sseEvent = (event: string, data: unknown) => encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);

// the same shape as a JSON error body, plus the status the response could no longer carry
const errorEvent = (e: HttpError) => sseEvent("error", { error: e.message, ...e.extra, status: e.status });

export const pageAiRoutes: Routes = (router, ctx) => {
  // everything a model call needs, with a slot held until release is called
  const prepare = (name: string, body: unknown, streaming: boolean) => {
    const page = pageSpec(ctx, name);
    if (!page.ai) throw new HttpError(403, `page ${name} may not use AI`);
    if (!ctx.agent) throw new HttpError(503, "no AI key is configured on this host", { code: "no_key" });
    const ask = readAsk(body, streaming);
    const { provider, languageModel } = ctx.agent.pageModel(ask.model);
    const release = ctx.agent.pageSlot();
    const call = {
      model: languageModel,
      ...(ask.system === undefined || ask.system.trim() === "" ? {} : { instructions: ask.system }),
      prompt: ask.prompt,
      maxOutputTokens: Math.min(
        ask.maxOutputTokens ?? page.ai.maxOutputTokens,
        page.ai.maxOutputTokens,
        PAGE_AI_MAX_TOKENS,
      ),
      // a provider's 429 goes straight back to the page, which decides when to try again
      maxRetries: 0,
    };
    return { ask, provider, release, call };
  };

  router.add("POST", "/api/pages/:page/ai", async ({ params, body, signal }) => {
    const { ask, provider, release, call } = prepare(params.page as string, body, false);
    try {
      if (ask.schema) {
        const r = await generateText({
          ...call,
          output: Output.object({ schema: jsonSchema(ask.schema as Parameters<typeof jsonSchema>[0]) }),
          abortSignal: signal,
        });
        return { object: r.output };
      }
      const r = await generateText({ ...call, abortSignal: signal });
      return { text: r.text };
    } catch (e) {
      throw modelError(e, provider);
    } finally {
      release();
    }
  });

  router.add("POST", "/api/pages/:page/ai/stream", async ({ params, body, signal }) => {
    const { provider, release, call } = prepare(params.page as string, body, true);
    const stop = new AbortController();
    let ping: ReturnType<typeof setInterval> | undefined;
    const finish = () => {
      clearInterval(ping);
      stop.abort();
      release();
    };
    const gone = () => stop.signal.aborted || signal.aborted;
    let parts: AsyncIterator<TextStreamPart<ToolSet>>;
    let head: IteratorResult<TextStreamPart<ToolSet>>;
    try {
      const r = streamText({
        ...call,
        abortSignal: AbortSignal.any([signal, stop.signal]),
        // errors arrive as stream parts below; the default handler would also print them
        onError: () => {},
      });
      parts = r.fullStream[Symbol.asyncIterator]();
      // "start" comes before the provider is called and "error" right after it when the call fails, so any
      // other part means the provider has answered: only then is the head sent, and a failed call stays a plain error
      for (;;) {
        head = await parts.next();
        if (head.done || head.value.type !== "start") break;
      }
      if (!head.done && head.value.type === "error") throw head.value.error;
    } catch (e) {
      finish();
      throw modelError(e, provider);
    }
    const stream = new ReadableStream<Uint8Array>({
      async start(k) {
        ping = setInterval(() => k.enqueue(encoder.encode(": ping\n\n")), KEEPALIVE_MS);
        try {
          for (let next = head; !next.done; next = await parts.next()) {
            const p = next.value;
            if (p.type === "abort") break;
            if (p.type === "text-delta") k.enqueue(sseEvent("delta", { text: p.text }));
            if (p.type === "error") {
              if (!gone()) k.enqueue(errorEvent(modelError(p.error, provider)));
              return;
            }
          }
          if (!gone()) k.enqueue(sseEvent("done", {}));
        } catch (e) {
          if (!gone()) k.enqueue(errorEvent(modelError(e, provider)));
        } finally {
          finish();
          try {
            k.close();
          } catch {}
        }
      },
      cancel: finish,
    });
    return new Response(stream, {
      headers: {
        "content-type": "text/event-stream; charset=utf-8",
        "cache-control": "no-store",
        connection: "keep-alive",
      },
    });
  });
};
