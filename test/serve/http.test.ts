import { connect } from "node:net";
import { join } from "node:path";
import { afterEach, expect, test } from "vitest";
import { open } from "../../src/index.ts";
import { serve } from "../../src/serve/index.ts";
import { dataRoot, tmpRoot } from "../helpers.ts";
import { fast, raw, type Served, startServe } from "./helpers.ts";

let t: Served | undefined;
afterEach(async () => {
  await t?.s.close();
  t = undefined;
});

test("requests without the token are refused", async () => {
  t = await startServe();
  expect((await raw(t.s.port, { path: "/api/health" })).status).toBe(401);
  expect((await raw(t.s.port, { path: "/" })).status).toBe(401);
  expect((await raw(t.s.port, { path: "/api/health", headers: { cookie: "yamlite_token=wrong" } })).status).toBe(401);
});

test("the printed URL logs in with an HttpOnly cookie", async () => {
  t = await startServe();
  const url = new URL(t.s.url);
  expect(url.hostname).toBe("127.0.0.1");
  const login = await raw(t.s.port, { path: url.pathname + url.search });
  expect(login.status).toBe(302);
  expect(login.headers.location).toBe("/");
  const cookie = String(login.headers["set-cookie"]);
  expect(cookie).toContain(`yamlite_token=${t.s.token}`);
  expect(cookie).toContain("HttpOnly");
  expect(cookie).toContain("SameSite=Strict");
  const page = await raw(t.s.port, { path: "/", headers: { cookie: t.cookie } });
  expect(page.status).toBe(200);
  expect(page.body).toContain("<title>yamlite</title>");
});

test("a bearer token works too", async () => {
  t = await startServe();
  const res = await fetch(`${t.base}/api/health`, { headers: { authorization: `Bearer ${t.s.token}` } });
  expect(res.status).toBe(200);
  expect(await res.json()).toEqual({ ok: true });
});

test("a foreign Host header is refused (DNS rebinding)", async () => {
  t = await startServe();
  const res = await raw(t.s.port, { path: "/api/health", headers: { cookie: t.cookie, host: "evil.example" } });
  expect(res.status).toBe(403);
});

test("a cross-origin write is refused, a same-origin one is not", async () => {
  t = await startServe();
  const host = `127.0.0.1:${t.s.port}`;
  const evil = await raw(t.s.port, {
    method: "POST",
    path: "/api/health",
    headers: { cookie: t.cookie, origin: "http://evil.example" },
  });
  expect(evil.status).toBe(403);
  const same = await raw(t.s.port, {
    method: "POST",
    path: "/api/health",
    headers: { cookie: t.cookie, origin: `http://${host}` },
  });
  expect(same.status).toBe(405);
});

test("static files are served only from the UI directory", async () => {
  t = await startServe();
  const asset = await raw(t.s.port, { path: "/assets/app.js", headers: { cookie: t.cookie } });
  expect(asset.status).toBe(200);
  expect(asset.headers["content-type"]).toContain("text/javascript");
  expect(asset.headers["cache-control"]).toContain("immutable");
  const escape = await raw(t.s.port, { path: "/..%2f..%2fpackage.json", headers: { cookie: t.cookie } });
  expect(escape.status).toBe(404);
  expect((await raw(t.s.port, { path: "/nope.js", headers: { cookie: t.cookie } })).status).toBe(404);
});

test("unknown API routes are 404", async () => {
  t = await startServe();
  expect((await t.api("/api/nope")).status).toBe(404);
});

test("a missing UI build is reported on the index page", async () => {
  const root = dataRoot();
  const s = await serve({ root, port: 0, uiDir: tmpRoot(), watch: fast });
  const page = await raw(s.port, { path: "/", headers: { cookie: `yamlite_token=${s.token}` } });
  expect(page.status).toBe(503);
  expect(page.body).toContain("pnpm build");
  await s.close();
});

test("serve refuses to start while another watcher holds the lock", async () => {
  const root = dataRoot();
  const y = await open({ root });
  const w = y.watch({}, fast);
  await w.ready;
  await expect(serve({ root, port: 0, uiDir: tmpRoot(), watch: fast })).rejects.toThrow(/another yamlite process/);
  await y.close();
});

test("close releases the lock", async () => {
  t = await startServe();
  await t.s.close();
  const y = await open({ root: t.root });
  await expect(y.sync()).resolves.toBeDefined();
  await y.close();
  t = undefined;
});

test("a port in use is reported and the lock is released", async () => {
  t = await startServe();
  const other = dataRoot();
  await expect(serve({ root: other, port: t.s.port, uiDir: tmpRoot(), watch: fast })).rejects.toThrow(
    /already in use; pick another one with --port/,
  );
  const y = await open({ root: other });
  await expect(y.sync()).resolves.toBeDefined();
  await y.close();
});

test("the database path follows --db", async () => {
  const root = dataRoot();
  const db = join(tmpRoot(), "custom.sqlite");
  t = await startServe({}, undefined, { root, db });
  expect((await t.api("/api/health")).status).toBe(200);
});

test("a malformed request target does not take the server down", async () => {
  t = await startServe();
  const port = t.s.port;
  const reply = await new Promise<string>((resolve, reject) => {
    const sock = connect(port, "127.0.0.1", () => {
      sock.write(`GET http://%zz/ HTTP/1.1\r\nHost: 127.0.0.1:${port}\r\nConnection: close\r\n\r\n`);
    });
    let data = "";
    sock.setEncoding("utf8");
    sock.on("data", (c: string) => (data += c));
    sock.on("end", () => resolve(data));
    sock.on("error", reject);
  });
  expect(reply).toMatch(/^HTTP\/1\.1 (400|500) /);
  expect((await t.api("/api/health")).status).toBe(200);
});

test("writes need a JSON content type, so cross-site simple requests cannot reach them", async () => {
  t = await startServe();
  const post = (headers: Record<string, string>) =>
    fetch(`${t!.base}/api/sql`, {
      method: "POST",
      headers: { cookie: t!.cookie, ...headers },
      body: '{"sql":"SELECT 1"}',
    });
  expect((await post({ "content-type": "text/plain" })).status).toBe(415);
  expect((await post({})).status).toBe(415);
  expect((await post({ "content-type": "application/json; charset=utf-8" })).status).toBe(200);
  const noBody = await fetch(`${t.base}/api/conflicts/x/dismiss`, { method: "POST", headers: { cookie: t.cookie } });
  expect(noBody.status).toBe(415);
});

test("the login redirect cannot point at another site", async () => {
  t = await startServe();
  const login = await raw(t.s.port, { path: `/.//evil.example/?token=${t.s.token}` });
  expect(login.status).toBe(302);
  expect(login.headers.location).toBe("/evil.example/");
});

test("JSON API responses carry a content-length, and an oversized body gets 413", async () => {
  t = await startServe();
  const ok = await raw(t.s.port, { path: "/api/health", headers: { cookie: t.cookie } });
  expect(Number(ok.headers["content-length"])).toBe(Buffer.byteLength(ok.body));
  const big = await fetch(`${t.base}/api/sql`, {
    method: "POST",
    headers: { cookie: t.cookie, "content-type": "application/json" },
    body: JSON.stringify({ sql: "x".repeat(1_100_000) }),
  });
  expect(big.status).toBe(413);
});
