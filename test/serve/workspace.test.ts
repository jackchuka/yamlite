import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { join } from "node:path";
import { afterEach, expect, test } from "vitest";
import { createHandler } from "../../src/serve/http.ts";
import { createWorkspace, type Workspace } from "../../src/serve/workspace.ts";
import { dataRoot, read, sql, tmpRoot, waitFor, write } from "../helpers.ts";
import { fast } from "./helpers.ts";

const open: Workspace[] = [];
const servers: Server[] = [];
afterEach(async () => {
  for (const s of servers.splice(0)) await new Promise<void>((r) => s.close(() => r()));
  for (const w of open.splice(0)) await w.close();
});

const TOKEN = "t".repeat(48);

async function workspace(title: string) {
  const root = dataRoot();
  write(join(root, "yamlite.yaml"), "tables:\n  tasks:\n    columns:\n      title: TEXT\n");
  write(join(root, "tasks/a.yaml"), `title: ${title}\n`);
  const w = await createWorkspace({ root, watch: fast, agents: [], mcpUrl: () => "", gh: null });
  open.push(w);
  const uiDir = tmpRoot();
  write(join(uiDir, "index.html"), "<!doctype html>");
  const policy = { token: TOKEN, allowedHosts: null, origin: null };
  const http = createServer(createHandler(w.router, () => policy, uiDir, w.mcp));
  servers.push(http);
  await new Promise<void>((r) => http.listen(0, "127.0.0.1", () => r()));
  const base = `http://127.0.0.1:${(http.address() as AddressInfo).port}`;
  const api = (path: string, init: { method?: string; body?: unknown } = {}) =>
    fetch(base + path, {
      method: init.method ?? "GET",
      headers: { authorization: `Bearer ${TOKEN}`, "content-type": "application/json" },
      body: init.body === undefined ? undefined : JSON.stringify(init.body),
    });
  return { root, w, api };
}

test("two workspaces in one process stay apart", async () => {
  const a = await workspace("A");
  const b = await workspace("B");
  const r = await a.api("/api/tables/tasks/rows/a", {
    method: "PATCH",
    body: { values: { title: "A2" }, base: { title: "A" } },
  });
  expect(r.status).toBe(200);
  await waitFor(() => read(join(a.root, "tasks/a.yaml")) === "title: A2\n");
  expect(read(join(b.root, "tasks/a.yaml"))).toBe("title: B\n");
  expect(sql(b.w.context.dbPath, "SELECT title FROM tasks")).toEqual([{ title: "B" }]);
});

test("closing a workspace releases its lock so the root can be opened again", async () => {
  const a = await workspace("A");
  await a.w.close();
  open.splice(open.indexOf(a.w), 1);
  const again = await createWorkspace({ root: a.root, watch: fast, agents: [], mcpUrl: () => "", gh: null });
  open.push(again);
  expect(again.context.root).toBe(a.root);
});
