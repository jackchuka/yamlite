// A scripted ACP agent for tests. Steps:
//   { "say": "text" }                       agent message chunk
//   { "echo": true }                        says the whole prompt it received
//   { "mcp": "tool", "args": {...} }        calls a yamlite MCP tool and says its text result
//   { "update": {...} }                     sends a raw session update
//   { "ask": { "title"?, "kind" }, "marker"?: "/path" }
//                                           asks permission; writes marker file if allowed; says allowed|denied
//   { "wait": 5000 }                        waits, ending early on cancel
//   { "mode": true }                        says the session mode that was set
//   { "meta": true }                        says the _meta session/new received, as JSON
//   { "crash": true }                       exits with code 3
//   { "token": true }                       says the Authorization header it was given for yamlite
//   { "echoHistory": true }                 says every user prompt of this session so far, joined with " | "
// FAKE_AGENT_PIDFILE=path records the process id.
// FAKE_AGENT_SLOW_INIT=ms delays initialize.
// FAKE_AGENT_LOGIN=1 makes session/new fail with auth_required.
// FAKE_AGENT_MCP_ON_START=1 makes session/new call MCP initialize and tools/list, as real adapters do,
//   and fail unless both answer 200.
// FAKE_AGENT_MODE=id makes session/new report modes, starting in that mode.
// FAKE_AGENT_MODE_STUCK=1 makes session/set_mode keep the starting mode and report it.
// FAKE_AGENT_STATE_DIR=dir keeps each session's prompts, replies and turn in dir/<sessionId>.json,
//   so a new process can resume or load the session.
// FAKE_AGENT_RESUME=both|resume|load|none picks what initialize advertises (default both).
// FAKE_AGENT_RESUME_FAIL=1 makes session/resume and session/load fail, after writing noise to stderr.
// FAKE_AGENT_EXIT_AFTER_RESUME=1 exits right after answering session/resume or session/load.
import { randomUUID } from "node:crypto";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { Readable, Writable } from "node:stream";
import { AgentSideConnection, ndJsonStream, PROTOCOL_VERSION, RequestError } from "@agentclientprotocol/sdk";

if (process.env.FAKE_AGENT_PIDFILE) writeFileSync(process.env.FAKE_AGENT_PIDFILE, String(process.pid));
const turns = process.env.FAKE_AGENT_SCENARIO
  ? JSON.parse(readFileSync(process.env.FAKE_AGENT_SCENARIO, "utf8"))
  : [[{ say: "hello" }]];
let mcp;
const sessions = new Map();
const statePath = (id) =>
  process.env.FAKE_AGENT_STATE_DIR ? join(process.env.FAKE_AGENT_STATE_DIR, `${id}.json`) : null;
const save = (id) => {
  const path = statePath(id);
  if (path) writeFileSync(path, JSON.stringify(sessions.get(id)));
};
const restore = (id) => {
  if (process.env.FAKE_AGENT_RESUME_FAIL) {
    process.stderr.write("STDERR-NOISE line one\nSTDERR-NOISE line two\n");
    throw new Error("cannot resume this session");
  }
  const path = statePath(id);
  if (!path || !existsSync(path)) throw RequestError.resourceNotFound(id);
  sessions.set(id, JSON.parse(readFileSync(path, "utf8")));
};
const resumeCaps = () => {
  const kind = process.env.FAKE_AGENT_RESUME ?? "both";
  return {
    ...(kind === "both" || kind === "load" ? { loadSession: true } : {}),
    ...(kind === "both" || kind === "resume" ? { sessionCapabilities: { resume: {} } } : {}),
  };
};
let cancelled = false;
let mode = process.env.FAKE_AGENT_MODE ?? "none";
let meta;

new AgentSideConnection(
  (conn) => {
    const say = (sessionId, text) => {
      sessions.get(sessionId)?.replies.push(text);
      return conn.sessionUpdate({
        sessionId,
        update: { sessionUpdate: "agent_message_chunk", content: { type: "text", text } },
      });
    };
    const modes = () => {
      if (!process.env.FAKE_AGENT_MODE) return {};
      const availableModes = [...new Set(["default", "plan", mode])].map((id) => ({ id, name: id }));
      return { modes: { currentModeId: mode, availableModes } };
    };
    const reopen = (p) => {
      restore(p.sessionId);
      mcp = p.mcpServers?.find((s) => s.type === "http");
      meta = p._meta;
      if (process.env.FAKE_AGENT_EXIT_AFTER_RESUME) setTimeout(() => process.exit(0), 0);
    };
    const callTool = async (name, args) => {
      const res = await fetch(mcp.url, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          accept: "application/json, text/event-stream",
          ...Object.fromEntries(mcp.headers.map((h) => [h.name, h.value])),
        },
        body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name, arguments: args } }),
      });
      const body = await res.json();
      return body.result?.content?.[0]?.text ?? JSON.stringify(body);
    };
    return {
      async initialize() {
        if (process.env.FAKE_AGENT_SLOW_INIT)
          await new Promise((r) => setTimeout(r, Number(process.env.FAKE_AGENT_SLOW_INIT)));
        return {
          protocolVersion: PROTOCOL_VERSION,
          agentCapabilities: { mcpCapabilities: { http: true }, ...resumeCaps() },
        };
      },
      async newSession(p) {
        if (process.env.FAKE_AGENT_LOGIN) throw RequestError.authRequired();
        mcp = p.mcpServers.find((s) => s.type === "http");
        meta = p._meta;
        if (process.env.FAKE_AGENT_MCP_ON_START) {
          for (const method of ["initialize", "tools/list"]) {
            const res = await fetch(mcp.url, {
              method: "POST",
              headers: {
                "content-type": "application/json",
                accept: "application/json, text/event-stream",
                ...Object.fromEntries(mcp.headers.map((h) => [h.name, h.value])),
              },
              body: JSON.stringify({
                jsonrpc: "2.0",
                id: method,
                method,
                params:
                  method === "initialize"
                    ? { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "fake", version: "0" } }
                    : {},
              }),
            });
            await res.text();
            if (res.status !== 200) throw new Error(`MCP ${method} answered ${res.status}`);
          }
        }
        const sessionId = `s-${randomUUID()}`;
        sessions.set(sessionId, { prompts: [], replies: [], turn: 0 });
        save(sessionId);
        return { sessionId, ...modes() };
      },
      async resumeSession(p) {
        reopen(p);
        return modes();
      },
      async loadSession(p) {
        reopen(p);
        const s = sessions.get(p.sessionId);
        for (const text of s.prompts)
          await conn.sessionUpdate({
            sessionId: p.sessionId,
            update: { sessionUpdate: "user_message_chunk", content: { type: "text", text } },
          });
        for (const text of s.replies)
          await conn.sessionUpdate({
            sessionId: p.sessionId,
            update: { sessionUpdate: "agent_message_chunk", content: { type: "text", text } },
          });
        return modes();
      },
      async authenticate() {},
      async setSessionMode(p) {
        if (process.env.FAKE_AGENT_MODE_STUCK) {
          await conn.sessionUpdate({
            sessionId: p.sessionId,
            update: { sessionUpdate: "current_mode_update", currentModeId: mode },
          });
          return {};
        }
        mode = p.modeId;
        return {};
      },
      async cancel() {
        cancelled = true;
      },
      async prompt(p) {
        cancelled = false;
        const session = sessions.get(p.sessionId);
        const history = [...session.prompts];
        session.prompts.push(p.prompt.at(-1)?.text ?? "");
        const turn = ++session.turn;
        save(p.sessionId);
        const steps = turns[Math.min(turn - 1, turns.length - 1)];
        try {
          return await play(p, steps, turn, history);
        } finally {
          save(p.sessionId);
        }
      },
    };
    async function play(p, steps, turn, history) {
      for (const [i, step] of steps.entries()) {
        if (cancelled) return { stopReason: "cancelled" };
        if (step.say) await say(p.sessionId, step.say);
        if (step.echoHistory) await say(p.sessionId, history.join(" | "));
        if (step.echo) await say(p.sessionId, p.prompt.map((b) => b.text).join("\n---\n"));
        if (step.mode) await say(p.sessionId, `mode:${mode}`);
        if (step.meta) await say(p.sessionId, JSON.stringify(meta ?? null));
        if (step.token) await say(p.sessionId, mcp.headers.find((h) => h.name === "Authorization")?.value ?? "");
        if (step.crash) {
          save(p.sessionId);
          process.exit(3);
        }
        if (step.update) await conn.sessionUpdate({ sessionId: p.sessionId, update: step.update });
        if (step.wait) {
          const end = Date.now() + step.wait;
          while (!cancelled && Date.now() < end) await new Promise((r) => setTimeout(r, 20));
        }
        if (step.mcp) {
          const id = `t${turn}-${i}`;
          await conn.sessionUpdate({
            sessionId: p.sessionId,
            update: {
              sessionUpdate: "tool_call",
              toolCallId: id,
              title: `mcp__yamlite__${step.mcp}`,
              kind: "other",
              status: "in_progress",
              rawInput: step.args,
            },
          });
          const text = await callTool(step.mcp, step.args ?? {});
          await conn.sessionUpdate({
            sessionId: p.sessionId,
            update: { sessionUpdate: "tool_call_update", toolCallId: id, status: "completed" },
          });
          await say(p.sessionId, text);
        }
        if (step.ask) {
          const r = await conn.requestPermission({
            sessionId: p.sessionId,
            toolCall: { toolCallId: step.toolCallId ?? `t${turn}-${i}`, ...step.ask },
            options: [
              { optionId: "yes", name: "Allow", kind: "allow_once" },
              { optionId: "no", name: "Reject", kind: "reject_once" },
            ],
          });
          const allowed = r.outcome.outcome === "selected" && r.outcome.optionId === "yes";
          if (allowed && step.marker) writeFileSync(step.marker, "ran");
          await say(p.sessionId, allowed ? "allowed" : "denied");
        }
      }
      return { stopReason: cancelled ? "cancelled" : "end_turn" };
    }
  },
  ndJsonStream(Writable.toWeb(process.stdout), Readable.toWeb(process.stdin)),
);
