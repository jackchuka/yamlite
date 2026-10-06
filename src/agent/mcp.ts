// just enough of MCP's streamable HTTP for an agent to list and call yamlite's tools: JSON answers, no SSE, no sessions

export interface McpTool {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
  call(args: Record<string, unknown>): unknown | Promise<unknown>;
}

export type JsonRpcResponse = {
  jsonrpc: "2.0";
  id: string | number | null;
  result?: unknown;
  error?: { code: number; message: string };
};

const VERSIONS = ["2025-11-25", "2025-06-18", "2025-03-26", "2024-11-05"];

const error = (id: JsonRpcResponse["id"], code: number, message: string): JsonRpcResponse => ({
  jsonrpc: "2.0",
  id,
  error: { code, message },
});

const text = (out: unknown): string => {
  if (typeof out === "string") return out;
  const result = JSON.stringify(out, (_, v) => {
    if (v instanceof Uint8Array) return Buffer.from(v).toString("base64");
    if (typeof v === "bigint") {
      const n = BigInt(v);
      const safe = BigInt(Number.MAX_SAFE_INTEGER);
      return n > -safe && n < safe ? Number(n) : n.toString();
    }
    return v;
  });
  return result ?? "null";
};

export async function handleMcp(
  message: unknown,
  tools: readonly McpTool[],
  version: string,
): Promise<JsonRpcResponse | null> {
  if (message === null || typeof message !== "object" || Array.isArray(message))
    return error(null, -32600, "invalid request");
  const m = message as { jsonrpc?: unknown; id?: unknown; method?: unknown; params?: unknown };
  if (m.jsonrpc !== "2.0" || typeof m.method !== "string") return error(null, -32600, "invalid request");
  if (m.id === undefined) return null;
  const id = typeof m.id === "string" || typeof m.id === "number" ? m.id : null;
  const params = (m.params ?? {}) as Record<string, unknown>;
  const ok = (result: unknown): JsonRpcResponse => ({ jsonrpc: "2.0", id, result });
  switch (m.method) {
    case "initialize": {
      const asked = params.protocolVersion;
      const protocolVersion = typeof asked === "string" && VERSIONS.includes(asked) ? asked : VERSIONS[0];
      return ok({ protocolVersion, capabilities: { tools: {} }, serverInfo: { name: "yamlite", version } });
    }
    case "ping":
      return ok({});
    case "tools/list":
      return ok({ tools: tools.map(({ name, description, inputSchema }) => ({ name, description, inputSchema })) });
    case "tools/call": {
      const tool = tools.find((t) => t.name === params.name);
      if (!tool) return error(id, -32602, `unknown tool: ${String(params.name)}`);
      if (
        params.arguments !== undefined &&
        (typeof params.arguments !== "object" || Array.isArray(params.arguments) || params.arguments === null)
      )
        return error(id, -32602, "arguments must be an object");
      const args = (params.arguments ?? {}) as Record<string, unknown>;
      try {
        return ok({ content: [{ type: "text", text: text(await tool.call(args)) }] });
      } catch (e) {
        return ok({ content: [{ type: "text", text: e instanceof Error ? e.message : String(e) }], isError: true });
      }
    }
    default:
      return error(id, -32601, `method not found: ${m.method}`);
  }
}
