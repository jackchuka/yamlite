import { timingSafeEqual } from "node:crypto";
import type { IncomingMessage } from "node:http";

export const COOKIE = "yamlite_token";

export interface AccessPolicy {
  token: string;
  // null when serving on a non-loopback address, where the Host cannot be predicted
  allowedHosts: Set<string> | null;
}

export type Access =
  | { kind: "ok" }
  | { kind: "login"; location: string }
  | { kind: "deny"; status: 401 | 403; message: string };

export const isLoopback = (host: string): boolean => host === "127.0.0.1" || host === "localhost" || host === "::1";

export const loopbackHosts = (port: number): Set<string> =>
  new Set([`127.0.0.1:${port}`, `localhost:${port}`, `[::1]:${port}`]);

export const same = (a: string, b: string): boolean => {
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
};

function cookieToken(header: string | undefined): string | undefined {
  for (const part of (header ?? "").split(";")) {
    const [name, ...value] = part.trim().split("=");
    if (name === COOKIE) return value.join("=");
  }
  return undefined;
}

export function checkAccess(req: IncomingMessage, url: URL, policy: AccessPolicy): Access {
  const host = req.headers.host ?? "";
  if (policy.allowedHosts && !policy.allowedHosts.has(host)) {
    return { kind: "deny", status: 403, message: "unexpected Host header" };
  }
  const method = req.method ?? "GET";
  const origin = req.headers.origin;
  if (method !== "GET" && method !== "HEAD" && origin !== undefined && origin !== `http://${host}`) {
    return { kind: "deny", status: 403, message: "cross-origin request" };
  }
  const fromQuery = url.searchParams.get("token");
  if (fromQuery !== null && same(fromQuery, policy.token) && method === "GET" && !url.pathname.startsWith("/api/")) {
    url.searchParams.delete("token");
    // "//host" would be a protocol-relative redirect to another site
    return { kind: "login", location: (url.pathname + url.search).replace(/^\/+/, "/") };
  }
  const bearer = /^Bearer (.+)$/.exec(req.headers.authorization ?? "")?.[1];
  const presented = bearer ?? cookieToken(req.headers.cookie);
  if (presented !== undefined && same(presented, policy.token)) return { kind: "ok" };
  return { kind: "deny", status: 401, message: "missing or wrong token; open the URL that yamlite serve printed" };
}

export const loginCookie = (token: string): string => `${COOKIE}=${token}; HttpOnly; SameSite=Strict; Path=/`;
