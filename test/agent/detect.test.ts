import { chmodSync } from "node:fs";
import { join } from "node:path";
import { expect, test } from "vitest";
import { type AgentInfo, detectAgents, which } from "../../src/agent/detect.ts";
import { tmpRoot, write } from "../helpers.ts";

function bin(names: string[]): string {
  const dir = tmpRoot();
  for (const n of names) {
    write(join(dir, n), "#!/bin/sh\n");
    chmodSync(join(dir, n), 0o755);
  }
  return dir;
}

test("which finds executables on PATH only", () => {
  const dir = bin(["claude"]);
  write(join(dir, "codex"), "not executable");
  expect(which("claude", { PATH: dir })).toBe(join(dir, "claude"));
  expect(which("codex", { PATH: dir })).toBeNull();
});

test("an agent needs its CLI; the adapter comes from PATH or npx", () => {
  expect(detectAgents({ PATH: bin(["npx"]) })).toEqual([]);
  const withAdapter = bin(["claude", "claude-agent-acp", "npx"]);
  expect(detectAgents({ PATH: withAdapter })).toEqual([
    expect.objectContaining({
      id: "claude",
      name: "Claude Code",
      command: join(withAdapter, "claude-agent-acp"),
      args: [],
      login: "claude",
    }),
  ]);
  const viaNpx = bin(["codex", "npx"]);
  expect(detectAgents({ PATH: viaNpx })).toEqual([
    {
      id: "codex",
      name: "Codex",
      command: join(viaNpx, "npx"),
      args: ["-y", "@agentclientprotocol/codex-acp@2.1.1"],
      login: "codex login",
      mode: "read-only",
      env: expect.objectContaining({ INITIAL_AGENT_MODE: "read-only" }),
    },
  ]);
  expect(detectAgents({ PATH: bin(["codex"]) })).toEqual([]);
});

test("YAMLITE_AGENT_COMMAND replaces detection", () => {
  expect(detectAgents({ PATH: "", YAMLITE_AGENT_COMMAND: '["node","fake.mjs"]' })).toEqual([
    { id: "test", name: "Test agent", command: "node", args: ["fake.mjs"], login: "login" },
  ]);
});

test("malformed YAMLITE_AGENT_COMMAND returns empty array", () => {
  expect(detectAgents({ PATH: "", YAMLITE_AGENT_COMMAND: "invalid json" })).toEqual([]);
  expect(detectAgents({ PATH: "", YAMLITE_AGENT_COMMAND: "[]" })).toEqual([]);
  expect(detectAgents({ PATH: "", YAMLITE_AGENT_COMMAND: '[""]' })).toEqual([]);
  expect(detectAgents({ PATH: "", YAMLITE_AGENT_COMMAND: "123" })).toEqual([]);
});

test("Claude starts in default mode, without user or project settings, and without tools that write or run", () => {
  const claude = detectAgents({ PATH: bin(["claude", "claude-agent-acp"]) })[0] as AgentInfo;
  expect(claude.mode).toBe("default");
  const options = (claude.sessionMeta as { claudeCode: { options: Record<string, unknown> } }).claudeCode.options;
  expect(options.settingSources).toEqual([]);
  expect(options.allowDangerouslySkipPermissions).toBe(false);
  expect(options.disallowedTools).toEqual(
    expect.arrayContaining(["Bash", "Edit", "MultiEdit", "Write", "NotebookEdit", "Task", "Agent", "Skill"]),
  );
});

test("Codex is held to read-only from its first turn", () => {
  const [codex] = detectAgents({ PATH: bin(["codex", "codex-acp"]) });
  expect(codex?.sessionMeta).toBeUndefined();
  expect(JSON.parse(codex?.env?.CODEX_CONFIG ?? "{}")).toEqual({
    approval_policy: "on-request",
    sandbox_mode: "read-only",
  });
});
