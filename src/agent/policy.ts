import { isAbsolute, relative, resolve } from "node:path";

export type Decision = "allow" | "deny";

export interface ToolRequest {
  title?: string | null;
  name?: string | null;
  kind?: string | null;
  locations?: Array<{ path: string }> | null;
}

// how the adapters name a tool of the MCP server registered as "yamlite"
// Accepts both Claude format (mcp__yamlite__<tool>) and Codex format (mcp.yamlite.<tool>)
const YAMLITE_TOOL = /^(?:mcp__yamlite__|mcp\.yamlite\.)\w+$/;
const READ_KINDS = new Set(["read", "search", "fetch", "think"]);

export const isYamliteTool = (call: ToolRequest): boolean => {
  // If name is present and non-empty, use name only
  if (call.name && typeof call.name === "string") {
    return YAMLITE_TOOL.test(call.name.trim());
  }
  // Otherwise, use title
  if (call.title && typeof call.title === "string") {
    return YAMLITE_TOOL.test(call.title.trim());
  }
  return false;
};

const inside = (root: string, path: string): boolean => {
  const rel = relative(resolve(root), resolve(root, path));
  return rel === "" || (!rel.startsWith("..") && !isAbsolute(rel));
};

// yamlite's own tools, and reading inside the data root; never a shell, an edit or another server's tool
export function decide(call: ToolRequest, root: string): Decision {
  if (isYamliteTool(call)) return "allow";
  if (!call.kind || !READ_KINDS.has(call.kind)) return "deny";

  // read and search require locations
  if ((call.kind === "read" || call.kind === "search") && (!call.locations || call.locations.length === 0)) {
    return "deny";
  }

  return (call.locations ?? []).every((l) => inside(root, l.path)) ? "allow" : "deny";
}

export function permissionOutcome(
  options: ReadonlyArray<{ optionId: string; kind: string }>,
  decision: Decision,
): { outcome: "cancelled" } | { outcome: "selected"; optionId: string } {
  const option = options.find((o) => o.kind === (decision === "allow" ? "allow_once" : "reject_once"));
  return option ? { outcome: "selected", optionId: option.optionId } : { outcome: "cancelled" };
}
