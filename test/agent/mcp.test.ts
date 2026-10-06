import { expect, test } from "vitest";
import { handleMcp, type McpTool } from "../../src/agent/mcp.ts";

const tools: McpTool[] = [
  { name: "echo", description: "Echo", inputSchema: { type: "object" }, call: (a) => ({ got: a.x, big: 2n ** 70n }) },
  {
    name: "boom",
    description: "Fails",
    inputSchema: { type: "object" },
    call: () => {
      throw new Error("nope");
    },
  },
  {
    name: "undef",
    description: "Returns undefined",
    inputSchema: { type: "object" },
    call: () => undefined,
  },
  {
    name: "bytes",
    description: "Returns bytes and bigint",
    inputSchema: { type: "object" },
    call: () => ({ b: new Uint8Array([1, 2, 3]), n: 2n ** 70n }),
  },
  {
    name: "throws_string",
    description: "Throws a non-Error string",
    inputSchema: { type: "object" },
    call: () => {
      throw "bad thing";
    },
  },
];
const rpc = (method: string, params?: unknown, id: number | undefined = 1) => ({ jsonrpc: "2.0", id, method, params });

test("initialize answers with a version the client asked for when known", async () => {
  const out = await handleMcp(rpc("initialize", { protocolVersion: "2025-06-18" }), tools, "1.2.3");
  expect(out).toEqual({
    jsonrpc: "2.0",
    id: 1,
    result: {
      protocolVersion: "2025-06-18",
      capabilities: { tools: {} },
      serverInfo: { name: "yamlite", version: "1.2.3" },
    },
  });
  const other = await handleMcp(rpc("initialize", { protocolVersion: "1999-01-01" }), tools, "1");
  expect((other!.result as { protocolVersion: string }).protocolVersion).toBe("2025-11-25");
});

test("notifications get no response", async () => {
  expect(await handleMcp({ jsonrpc: "2.0", method: "notifications/initialized" }, tools, "1")).toBeNull();
});

test("tools/list and tools/call", async () => {
  const list = await handleMcp(rpc("tools/list"), tools, "1");
  expect((list!.result as { tools: Array<{ name: string }> }).tools.map((t) => t.name)).toEqual([
    "echo",
    "boom",
    "undef",
    "bytes",
    "throws_string",
  ]);
  const ok = await handleMcp(rpc("tools/call", { name: "echo", arguments: { x: 1 } }), tools, "1");
  expect(ok?.result).toEqual({ content: [{ type: "text", text: '{"got":1,"big":"1180591620717411303424"}' }] });
  const failed = await handleMcp(rpc("tools/call", { name: "boom", arguments: {} }), tools, "1");
  expect(failed?.result).toEqual({ content: [{ type: "text", text: "nope" }], isError: true });
  const unknown = await handleMcp(rpc("tools/call", { name: "nope" }), tools, "1");
  expect(unknown?.error?.code).toBe(-32602);
});

test("bad messages get JSON-RPC errors", async () => {
  expect((await handleMcp([rpc("ping")], tools, "1"))?.error?.code).toBe(-32600);
  expect((await handleMcp({ hello: 1 }, tools, "1"))?.error?.code).toBe(-32600);
  expect((await handleMcp(rpc("resources/list"), tools, "1"))?.error?.code).toBe(-32601);
  expect((await handleMcp(rpc("ping"), tools, "1"))?.result).toEqual({});
});

test("undefined return value yields text null", async () => {
  const res = await handleMcp(rpc("tools/call", { name: "undef", arguments: {} }), tools, "1");
  expect(res?.result).toEqual({ content: [{ type: "text", text: "null" }] });
});

test("Uint8Array is base64 encoded with bigint preserved", async () => {
  const res = await handleMcp(rpc("tools/call", { name: "bytes", arguments: {} }), tools, "1");
  expect(res?.result).toEqual({
    content: [{ type: "text", text: '{"b":"AQID","n":"1180591620717411303424"}' }],
  });
});

test("tools/call with invalid arguments type returns error", async () => {
  const string_args = await handleMcp(rpc("tools/call", { name: "echo", arguments: "not an object" }), tools, "1");
  expect(string_args?.error?.code).toBe(-32602);
  expect(string_args?.error?.message).toContain("arguments must be an object");

  const number_args = await handleMcp(rpc("tools/call", { name: "echo", arguments: 42 }), tools, "1");
  expect(number_args?.error?.code).toBe(-32602);

  const array_args = await handleMcp(rpc("tools/call", { name: "echo", arguments: [1, 2, 3] }), tools, "1");
  expect(array_args?.error?.code).toBe(-32602);

  const no_args = await handleMcp(rpc("tools/call", { name: "echo" }), tools, "1");
  expect(no_args?.result).toBeDefined();
});

test("request ids 0 and string are echoed", async () => {
  const id0 = await handleMcp({ jsonrpc: "2.0", id: 0, method: "ping" }, tools, "1");
  expect(id0?.id).toBe(0);

  const stringId = await handleMcp({ jsonrpc: "2.0", id: "abc", method: "ping" }, tools, "1");
  expect(stringId?.id).toBe("abc");
});

test("tool throwing non-Error string returns isError with that string", async () => {
  const res = await handleMcp(rpc("tools/call", { name: "throws_string", arguments: {} }), tools, "1");
  expect(res?.result).toEqual({ content: [{ type: "text", text: "bad thing" }], isError: true });
});
