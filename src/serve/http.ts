import { createReadStream, statSync } from "node:fs";
import type { IncomingMessage, ServerResponse } from "node:http";
import { extname, resolve, sep } from "node:path";
import { pipeline } from "node:stream";
import { BusyError, isConstraintError } from "../store.ts";
import { type AccessPolicy, checkAccess, loginCookie } from "./security.ts";

export class HttpError extends Error {
  constructor(
    readonly status: number,
    message: string,
    readonly extra: Record<string, unknown> = {},
  ) {
    super(message);
  }
}

export class Reply {
  constructor(
    readonly status: number,
    readonly body: unknown,
  ) {}
}

// returned by a handler that wrote the response itself (SSE)
export const STREAMED = Symbol("streamed");

export interface ApiRequest {
  params: Record<string, string>;
  query: URLSearchParams;
  body: unknown;
  raw: IncomingMessage;
  res: ServerResponse;
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
}

const jsonReplacer = (_key: string, value: unknown) => (typeof value === "bigint" ? value.toString() : value);

export function sendJson(res: ServerResponse, status: number, body: unknown): void {
  res.writeHead(status, { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" });
  res.end(JSON.stringify(body, jsonReplacer));
}

const MAX_BODY = 1_048_576;

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

export function createHandler(router: Router, policy: () => AccessPolicy, uiDir: string) {
  const handle = handleRequest(router, policy, uiDir);
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

function handleRequest(router: Router, policy: () => AccessPolicy, uiDir: string) {
  return async (req: IncomingMessage, res: ServerResponse): Promise<void> => {
    const url = new URL(req.url ?? "/", "http://localhost");
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
    const match = router.match(method, url.pathname);
    if (match === null) {
      notFound(res);
      return;
    }
    if (match === "method") {
      sendJson(res, 405, { error: "method not allowed" });
      return;
    }
    try {
      let body: unknown;
      if (method !== "GET" && method !== "HEAD") {
        // anything but JSON would be a "simple" cross-site request that skips the CORS preflight
        if (!/^application\/json\s*(;|$)/i.test(req.headers["content-type"] ?? "")) {
          throw new HttpError(415, "content-type must be application/json");
        }
        body = await readJson(req);
      }
      const out = await match.handler({ params: match.params, query: url.searchParams, body, raw: req, res });
      if (out === STREAMED) return;
      if (out instanceof Reply) sendJson(res, out.status, out.body);
      else sendJson(res, 200, out ?? { ok: true });
    } catch (e) {
      if (e instanceof HttpError) sendJson(res, e.status, { error: e.message, ...e.extra });
      else if (e instanceof BusyError) sendJson(res, 503, { error: "the database is busy; try again" });
      else if (isConstraintError(e)) sendJson(res, 400, { error: e.message });
      else sendJson(res, 500, { error: e instanceof Error ? e.message : String(e) });
    }
  };
}
