import { createReadStream, statSync } from "node:fs";
import type { IncomingMessage, ServerResponse } from "node:http";
import { extname, resolve, sep } from "node:path";
import { pipeline, Readable } from "node:stream";
import { BusyError, isConstraintError } from "../store.ts";
import { type AccessPolicy, checkAccess, loginCookie } from "./security.ts";
import { HttpError } from "./errors.ts";

export { HttpError };

export class Reply {
  constructor(
    readonly status: number,
    readonly body: unknown,
  ) {}
}

export interface ApiRequest {
  params: Record<string, string>;
  query: URLSearchParams;
  body: unknown;
  signal: AbortSignal;
}

export type Handler = (req: ApiRequest) => unknown;

interface Route {
  method: string;
  parts: string[];
  handler: Handler;
}

export class Router {
  private readonly routes: Route[] = [];

  add(method: string, pattern: string, handler: Handler): this {
    this.routes.push({ method, parts: pattern.split("/").filter(Boolean), handler });
    return this;
  }

  // splits before decoding, so an encoded "/" stays inside its segment
  match(method: string, pathname: string): { handler: Handler; params: Record<string, string> } | "method" | null {
    const segments = pathname.split("/").filter(Boolean);
    let wrongMethod = false;
    for (const route of this.routes) {
      if (route.parts.length !== segments.length) continue;
      const params: Record<string, string> = {};
      const matched = route.parts.every((part, i) => {
        const segment = segments[i] as string;
        if (!part.startsWith(":")) return part === segment;
        try {
          params[part.slice(1)] = decodeURIComponent(segment);
          return true;
        } catch {
          return false;
        }
      });
      if (!matched) continue;
      if (route.method !== method) {
        wrongMethod = true;
        continue;
      }
      return { handler: route.handler, params };
    }
    return wrongMethod ? "method" : null;
  }

  async dispatch(request: Request): Promise<Response> {
    const url = new URL(request.url);
    const match = this.match(request.method, url.pathname);
    if (match === null) return json(404, { error: "not found" });
    if (match === "method") return json(405, { error: "method not allowed" });
    try {
      let body: unknown;
      if (request.method !== "GET" && request.method !== "HEAD") {
        // anything but JSON would be a "simple" cross-site request that skips the CORS preflight
        if (!/^application\/json\s*(;|$)/i.test(request.headers.get("content-type") ?? ""))
          throw new HttpError(415, "content-type must be application/json");
        body = await readBody(request);
      }
      const out = await match.handler({ params: match.params, query: url.searchParams, body, signal: request.signal });
      if (out instanceof Response) return out;
      if (out instanceof Reply) return json(out.status, out.body);
      return json(200, out ?? { ok: true });
    } catch (e) {
      if (e instanceof HttpError) return json(e.status, { error: e.message, ...e.extra });
      if (e instanceof BusyError) return json(503, { error: "the database is busy; try again" });
      if (isConstraintError(e)) return json(400, { error: e.message });
      return json(500, { error: e instanceof Error ? e.message : String(e) });
    }
  }
}

const jsonReplacer = (_key: string, value: unknown) => (typeof value === "bigint" ? value.toString() : value);

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body, jsonReplacer), {
    status,
    headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" },
  });

export function sendJson(res: ServerResponse, status: number, body: unknown): void {
  res.writeHead(status, { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" });
  res.end(JSON.stringify(body, jsonReplacer));
}

const MAX_BODY = 1_048_576;

async function readBody(request: Request): Promise<unknown> {
  const tooLarge = () => new HttpError(413, "request body is too large");
  if (Number(request.headers.get("content-length")) > MAX_BODY) throw tooLarge();
  const chunks: Uint8Array[] = [];
  let size = 0;
  if (request.body) {
    const reader = request.body.getReader();
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      size += value.length;
      if (size > MAX_BODY) {
        await reader.cancel().catch(() => {});
        throw tooLarge();
      }
      chunks.push(value);
    }
  }
  const text = Buffer.concat(chunks).toString("utf8");
  if (text.trim() === "") return undefined;
  try {
    return JSON.parse(text) as unknown;
  } catch {
    throw new HttpError(400, "invalid JSON body");
  }
}

export async function sendResponse(res: ServerResponse, response: Response): Promise<void> {
  const headers = Object.fromEntries(response.headers);
  if (!response.body || !headers["content-type"]?.startsWith("text/event-stream")) {
    const body = Buffer.from(await response.arrayBuffer());
    res.writeHead(response.status, { ...headers, "content-length": body.length });
    res.end(body);
    return;
  }
  res.writeHead(response.status, headers);
  // flushHeaders so an event stream reaches the client before its first event
  res.flushHeaders();
  for await (const chunk of response.body as unknown as AsyncIterable<Uint8Array>) {
    if (!res.write(chunk)) await new Promise((r) => res.once("drain", r));
  }
  res.end();
}

export async function readJson(req: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req) {
    size += (chunk as Buffer).length;
    if (size > MAX_BODY) throw new HttpError(413, "request body is too large");
    chunks.push(chunk as Buffer);
  }
  const text = Buffer.concat(chunks).toString("utf8");
  if (text.trim() === "") return undefined;
  try {
    return JSON.parse(text) as unknown;
  } catch {
    throw new HttpError(400, "invalid JSON body");
  }
}

const TYPES: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".ico": "image/x-icon",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
};

function notFound(res: ServerResponse): void {
  sendJson(res, 404, { error: "not found" });
}

function isFile(path: string): boolean {
  try {
    return statSync(path).isFile();
  } catch {
    return false;
  }
}

export function serveStatic(uiDir: string, pathname: string, res: ServerResponse): void {
  const base = resolve(uiDir);
  let rel: string;
  try {
    rel = decodeURIComponent(pathname === "/" ? "/index.html" : pathname);
  } catch {
    notFound(res);
    return;
  }
  const file = resolve(base, `.${rel}`);
  if (!file.startsWith(base + sep)) {
    notFound(res);
    return;
  }
  if (!isFile(file)) {
    if (pathname !== "/") {
      notFound(res);
      return;
    }
    res.writeHead(503, { "content-type": "text/plain; charset=utf-8" });
    res.end("the UI is not built; run pnpm build\n");
    return;
  }
  // Vite puts hashed file names under assets/, so they never change
  const cache = rel.startsWith("/assets/") ? "public, max-age=31536000, immutable" : "no-cache";
  res.writeHead(200, { "content-type": TYPES[extname(file)] ?? "application/octet-stream", "cache-control": cache });
  pipeline(createReadStream(file), res, () => {});
}

export type McpHandler = (req: IncomingMessage, res: ServerResponse) => Promise<void>;

export function createHandler(router: Router, policy: () => AccessPolicy, uiDir: string, mcp?: McpHandler) {
  const handle = handleRequest(router, policy, uiDir, mcp);
  // no request may reject this promise: an unhandled rejection would end the process
  return async (req: IncomingMessage, res: ServerResponse): Promise<void> => {
    try {
      await handle(req, res);
    } catch (e) {
      if (res.headersSent) res.destroy();
      else if (e instanceof TypeError && (e as NodeJS.ErrnoException).code === "ERR_INVALID_URL") {
        sendJson(res, 400, { error: "invalid request URL" });
      } else sendJson(res, 500, { error: e instanceof Error ? e.message : String(e) });
    }
  };
}

function handleRequest(router: Router, policy: () => AccessPolicy, uiDir: string, mcp?: McpHandler) {
  return async (req: IncomingMessage, res: ServerResponse): Promise<void> => {
    const url = new URL(req.url ?? "/", "http://localhost");
    if (url.pathname === "/mcp" && mcp) {
      const p = policy();
      if (p.allowedHosts && !p.allowedHosts.has(req.headers.host ?? "")) {
        sendJson(res, 403, { error: "unexpected Host header" });
        return;
      }
      // agents call from outside any browser; a browser page must never reach this
      if (req.headers.origin !== undefined) {
        sendJson(res, 403, { error: "cross-origin request" });
        return;
      }
      await mcp(req, res);
      return;
    }
    const access = checkAccess(req, url, policy());
    if (access.kind === "deny") {
      sendJson(res, access.status, { error: access.message });
      return;
    }
    if (access.kind === "login") {
      res.writeHead(302, { location: access.location, "set-cookie": loginCookie(policy().token) });
      res.end();
      return;
    }
    const method = req.method ?? "GET";
    if (!url.pathname.startsWith("/api/")) {
      if (method === "GET" || method === "HEAD") serveStatic(uiDir, url.pathname, res);
      else sendJson(res, 405, { error: "method not allowed" });
      return;
    }
    const ac = new AbortController();
    res.on("close", () => ac.abort());
    const request = new Request(url, {
      method,
      headers: req.headers as Record<string, string>,
      body: method === "GET" || method === "HEAD" ? undefined : (Readable.toWeb(req) as ReadableStream),
      duplex: "half",
      signal: ac.signal,
    } as RequestInit);
    await sendResponse(res, await router.dispatch(request));
  };
}
