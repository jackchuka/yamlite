import { accessSync, constants, statSync } from "node:fs";
import { delimiter, join } from "node:path";

export interface AgentInfo {
  id: string;
  name: string;
  command: string;
  args: string[];
  // what to run in a terminal to log in, shown when the agent says it needs a login
  login: string;
  // the ACP session mode that keeps the agent from running commands on its own
  mode?: string;
  // session/new _meta, for adapter options that ACP has no field for
  sessionMeta?: Record<string, unknown>;
  env?: Record<string, string>;
}

interface Known {
  id: string;
  name: string;
  cli: string;
  adapter: string;
  pkg: string;
  login: string;
  mode?: string;
  sessionMeta?: Record<string, unknown>;
  env?: Record<string, string>;
}

// Claude Code tools that write files, run commands or start other agents
const CLAUDE_DISALLOWED = [
  "Bash",
  "BashOutput",
  "KillShell",
  "PowerShell",
  "Monitor",
  "Edit",
  "MultiEdit",
  "Write",
  "NotebookEdit",
  "Task",
  "Agent",
  "TaskOutput",
  "TaskStop",
  "Skill",
  "SlashCommand",
  "Workflow",
  "EnterWorktree",
  "ExitWorktree",
  "ExitPlanMode",
  "CronCreate",
  "ScheduleWakeup",
  "RemoteTrigger",
];

const KNOWN: Known[] = [
  {
    id: "claude",
    name: "Claude Code",
    cli: "claude",
    adapter: "claude-agent-acp",
    pkg: "@agentclientprotocol/claude-agent-acp@0.86.0",
    login: "claude",
    mode: "default",
    // without user/project/local settings, so their defaultMode, allow rules and hooks cannot skip the permission requests
    sessionMeta: {
      claudeCode: {
        options: { settingSources: [], allowDangerouslySkipPermissions: false, disallowedTools: CLAUDE_DISALLOWED },
      },
    },
  },
  {
    id: "codex",
    name: "Codex",
    cli: "codex",
    adapter: "codex-acp",
    pkg: "@agentclientprotocol/codex-acp@2.1.1",
    login: "codex login",
    mode: "read-only",
    env: {
      INITIAL_AGENT_MODE: "read-only",
      CODEX_CONFIG: JSON.stringify({ approval_policy: "on-request", sandbox_mode: "read-only" }),
    },
  },
];

export function which(cmd: string, env: NodeJS.ProcessEnv = process.env): string | null {
  const exts = process.platform === "win32" ? (env.PATHEXT ?? ".EXE;.CMD;.BAT").split(";") : [""];
  for (const dir of (env.PATH ?? "").split(delimiter).filter(Boolean)) {
    for (const ext of exts) {
      const path = join(dir, cmd + ext);
      try {
        if (!statSync(path).isFile()) continue;
        accessSync(path, constants.X_OK);
        return path;
      } catch {
        // not here
      }
    }
  }
  return null;
}

export function detectAgents(env: NodeJS.ProcessEnv = process.env): AgentInfo[] {
  if (env.YAMLITE_AGENT_COMMAND) {
    try {
      const parsed = JSON.parse(env.YAMLITE_AGENT_COMMAND);
      if (!Array.isArray(parsed) || parsed.length === 0 || typeof parsed[0] !== "string" || !parsed[0]) {
        return [];
      }
      const [command, ...args] = parsed as string[];
      return [{ id: "test", name: env.YAMLITE_AGENT_NAME ?? "Test agent", command, args, login: "login" }];
    } catch {
      return [];
    }
  }
  const npx = which("npx", env);
  return KNOWN.flatMap((k) => {
    if (!which(k.cli, env)) return [];
    const adapter = which(k.adapter, env);
    const launch = adapter ? { command: adapter, args: [] } : npx ? { command: npx, args: ["-y", k.pkg] } : null;
    if (!launch) return [];
    return [
      {
        id: k.id,
        name: k.name,
        ...launch,
        login: k.login,
        ...(k.mode ? { mode: k.mode } : {}),
        ...(k.sessionMeta ? { sessionMeta: k.sessionMeta } : {}),
        ...(k.env ? { env: k.env } : {}),
      },
    ];
  });
}
