import { type ChildProcess, spawn } from "node:child_process";
import { randomBytes } from "node:crypto";
import { Readable, Writable } from "node:stream";
import {
  ClientSideConnection,
  ndJsonStream,
  PROTOCOL_VERSION,
  type SessionModeState,
  type SessionNotification,
} from "@agentclientprotocol/sdk";
import { same } from "../serve/security.ts";
import { HttpError } from "../serve/http.ts";
import type { AgentInfo } from "./detect.ts";
import { type Decision, decide, permissionOutcome, type ToolRequest } from "./policy.ts";
import type { Proposal } from "./proposals.ts";

export type AgentEvent =
  | { type: "user"; text: string }
  | { type: "text"; text: string }
  | { type: "tool"; id: string; title?: string; kind?: string | null; status?: string | null; input?: unknown }
  | { type: "proposal"; proposal: Proposal }
  | { type: "busy"; busy: boolean }
  // detail: the end of the agent's stderr, for debugging; not shown in the chat
  | { type: "error"; message: string; code?: "resume_failed"; detail?: string }
  | { type: "closed"; message?: string };

// active: the agent process runs (or is starting); dormant: stopped, resumed by the next prompt; failed: cannot be resumed
export type ConversationStatus = "active" | "dormant" | "failed";

export interface ConversationSummary {
  id: string;
  agent: string;
  title: string;
  updatedAt: string;
  status: ConversationStatus;
}

export class AgentStartError extends Error {
  constructor(
    readonly code: "spawn" | "login" | "protocol",
    message: string,
    // the message without the agent's stderr
    readonly reason: string = message,
  ) {
    super(message);
  }
}

// the process was stopped or replaced while it was starting
class Superseded extends Error {}

const START_TIMEOUT_MS = 120_000;
const IDLE_MS = 10 * 60_000;
const MAX_CONVERSATIONS = 20;
const TITLE_LENGTH = 30;
const KEEP_STDERR = 4000;
const DETAIL_LENGTH = 300;
const STOPPED_MESSAGE = "エージェントが停止しました。次のメッセージで会話を再開します。";
const AUTH_REQUIRED = -32000;

// sent once, before the user's first message
const PREAMBLE = `You are helping a user look up and edit the data in a yamlite folder (YAML files kept in sync with SQLite).
Use the tools of the "yamlite" MCP server: start with schema, read with query and get_records.
You cannot write files or run commands. To change data, call propose_changes, propose_sql or propose_table: they only create a proposal. The proposal appears as a card in this same chat panel, and the user applies it there with the card's apply button ("N 件を適用"). After creating one, tell the user to review the card above and press its apply button; do not send them elsewhere in the UI. Never say data was changed until you are told it was applied.
For questions about the schema, yamlite.yaml or how to structure data, read the guide tool first. Its workflow is for explaining: you cannot run yamlite commands or edit yamlite.yaml; propose_table is the only schema change you can propose.
Reply in the language the user writes in, briefly and without SQL unless they ask for it.`;

export const GIT_NOTE = `The data folder is in a git repository. Read it with git_status, git_diff, git_log and git_branches. To branch, commit, push, open a pull request or switch branches, call propose_git with the steps in order; like other proposals it runs only when the user presses the card's button ("Run N steps" / "N 件の手順を実行"). Read git_status first and choose the files to commit yourself: only files related to what the user asked. Pull requests are created as drafts. In the proposal title or your reply, say what the user will see afterwards, e.g. that switching back to the default branch hides the committed changes until the PR is merged and pulled, and that uncommitted changes stay as they are.`;

// the text of the turn that follows a finished git proposal; its result arrives as feedback before it
export const GIT_DONE = `The git steps you proposed have finished; their result is above. Tell the user briefly what happened, with the pull request link if there is one. If a step failed, say what to do next.`;

const titleOf = (text: string) => {
  const t = text.replace(/\s+/g, " ").trim();
  return t.length > TITLE_LENGTH ? `${t.slice(0, TITLE_LENGTH)}…` : t;
};
const tail = (text: string) => text.trim().slice(-DETAIL_LENGTH);
const firstLine = (text: string) => (text.split("\n")[0] ?? "").slice(0, DETAIL_LENGTH);

export class Conversation {
  readonly events: AgentEvent[] = [];
  busy = false;
  failed = false;
  sessionId = "";
  greeted = false;
  // a new one for each process, so a stopped process's MCP connections stop working
  token = "";
  stderr = "";
  mode: string | undefined;
  title = "";
  updatedAt = Date.now();
  child: ChildProcess | null = null;
  conn: ClientSideConnection | null = null;
  // session/load replays the history as updates; the events already hold it
  replaying = false;
  resuming = false;
  // cancel arrived while resuming: drop the prompt that waits for the resume
  cancelled = false;
  readonly toolCalls = new Map<string, ToolRequest>();
  private readonly listeners = new Set<(e: AgentEvent) => void>();
  reaper: NodeJS.Timeout | undefined;
  onChange: () => void = () => {};

  constructor(
    readonly id: string,
    readonly agent: AgentInfo,
  ) {}

  get status(): ConversationStatus {
    return this.failed ? "failed" : this.child ? "active" : "dormant";
  }

  get subscribers(): number {
    return this.listeners.size;
  }

  summary(): ConversationSummary {
    return {
      id: this.id,
      agent: this.agent.id,
      title: this.title,
      updatedAt: new Date(this.updatedAt).toISOString(),
      status: this.status,
    };
  }

  subscribe(fn: (e: AgentEvent) => void): () => void {
    this.listeners.add(fn);
    this.onChange();
    return () => {
      if (this.listeners.delete(fn)) this.onChange();
    };
  }

  emit(e: AgentEvent): void {
    this.events.push(e);
    this.updatedAt = Date.now();
    if (e.type === "user" && !this.title) this.title = titleOf(e.text);
    for (const fn of this.listeners) fn(e);
    if (e.type === "busy") this.onChange();
  }
}

export interface HostOptions {
  // appended to the preamble
  notes?: string[];
  root: string;
  agents: AgentInfo[];
  mcpUrl: () => string;
  feedback: (conversationId: string) => string[];
  // the agent process of a conversation with no event subscriber and no running turn is stopped after this long
  idleMs?: number;
  // past this, the oldest stopped conversations are dropped
  maxConversations?: number;
}

export class AgentHost {
  private readonly conversations = new Map<string, Conversation>();
  private readonly pending = new Set<Conversation>();
  private closed = false;

  constructor(private readonly opts: HostOptions) {}

  get agents(): AgentInfo[] {
    return this.opts.agents;
  }

  get(id: string): Conversation | undefined {
    return this.conversations.get(id);
  }

  list(): ConversationSummary[] {
    return [...this.conversations.values()].sort((a, b) => b.updatedAt - a.updatedAt).map((c) => c.summary());
  }

  byToken(token: string): Conversation | undefined {
    // adapters connect to MCP servers during session/new, before the conversation is listed
    for (const c of [...this.conversations.values(), ...this.pending])
      if (c.child && !c.failed && same(c.token, token)) return c;
    return undefined;
  }

  async start(agentId: string): Promise<Conversation> {
    const agent = this.opts.agents.find((a) => a.id === agentId);
    if (!agent) throw new HttpError(404, `unknown agent: ${agentId}`);
    const c = new Conversation(randomBytes(8).toString("hex"), agent);
    this.pending.add(c);
    try {
      await this.launch(c, () => this.open(c));
    } finally {
      this.pending.delete(c);
    }
    this.evict();
    this.conversations.set(c.id, c);
    c.onChange = () => this.watchIdle(c);
    this.watchIdle(c);
    return c;
  }

  prompt(id: string, text: string): void {
    const c = this.mustGet(id);
    if (c.failed) throw new HttpError(409, "this conversation could not be resumed; start a new one");
    if (c.busy) throw new HttpError(409, "the agent is busy with the previous message");
    c.emit({ type: "user", text });
    this.turn(c, text);
  }

  // a turn the user did not type, so that the agent reports what just happened (e.g. git steps that ran);
  // a busy or failed conversation gets the queued feedback with its next prompt instead
  notify(id: string, text: string): void {
    const c = this.conversations.get(id);
    if (!c || c.failed || c.busy) return;
    this.turn(c, text);
  }

  private turn(c: Conversation, text: string): void {
    c.busy = true;
    c.emit({ type: "busy", busy: true });
    if (c.child) {
      this.send(c, text);
      return;
    }
    c.resuming = true;
    c.cancelled = false;
    this.launch(c, () => this.resume(c)).then(
      () => {
        c.resuming = false;
        if (c.cancelled || !c.conn) this.idle(c);
        else this.send(c, text);
      },
      (e: unknown) => {
        c.resuming = false;
        if (!(e instanceof Superseded)) {
          c.failed = true;
          const message = e instanceof AgentStartError ? e.reason : e instanceof Error ? e.message : String(e);
          c.emit({ type: "error", code: "resume_failed", message: firstLine(message), detail: tail(c.stderr) });
        }
        this.idle(c);
      },
    );
  }

  async cancel(id: string): Promise<void> {
    const c = this.mustGet(id);
    if (c.resuming) c.cancelled = true;
    else if (c.child && c.conn) await c.conn.cancel({ sessionId: c.sessionId });
  }

  // stops the agent process; the conversation stays and resumes on the next prompt
  async stop(id: string): Promise<void> {
    const c = this.mustGet(id);
    clearTimeout(c.reaper);
    await this.halt(c);
  }

  async end(id: string): Promise<void> {
    const c = this.mustGet(id);
    this.conversations.delete(id);
    clearTimeout(c.reaper);
    this.opts.feedback(id);
    c.emit({ type: "closed" });
    await this.halt(c);
  }

  publish(conversationId: string, e: AgentEvent): void {
    this.conversations.get(conversationId)?.emit(e);
  }

  async close(): Promise<void> {
    this.closed = true;
    const all = [...this.conversations.values(), ...this.pending];
    this.conversations.clear();
    await Promise.all(
      all.map((c) => {
        clearTimeout(c.reaper);
        return this.halt(c);
      }),
    );
  }

  private idle(c: Conversation): void {
    if (!c.busy) return;
    c.busy = false;
    c.emit({ type: "busy", busy: false });
  }

  private send(c: Conversation, text: string): void {
    const conn = c.conn;
    if (!conn) {
      this.idle(c);
      return;
    }
    const lead = [
      ...(c.greeted ? [] : [[PREAMBLE, ...(this.opts.notes ?? [])].join("\n")]),
      ...this.opts.feedback(c.id),
    ];
    c.greeted = true;
    const prompt = [
      ...(lead.length > 0 ? [{ type: "text" as const, text: lead.join("\n") }] : []),
      { type: "text" as const, text },
    ];
    conn
      .prompt({ sessionId: c.sessionId, prompt })
      .then(
        () => {},
        (e: unknown) => {
          // a dead process is reported once, by its exit
          if (!conn.signal.aborted && c.conn === conn)
            c.emit({ type: "error", message: e instanceof Error ? e.message : JSON.stringify(e) });
        },
      )
      .finally(() => {
        // a turn of a stopped process must not end the turn of the next one
        if (c.conn === conn) this.idle(c);
      });
  }

  // spawns the adapter and runs the handshake; on failure the process is killed
  private async launch(c: Conversation, handshake: () => Promise<void>): Promise<void> {
    if (this.closed) throw new AgentStartError("spawn", "yamlite is shutting down");
    const { agent } = c;
    const child = spawn(agent.command, agent.args, {
      cwd: this.opts.root,
      stdio: ["pipe", "pipe", "pipe"],
      ...(agent.env ? { env: { ...process.env, ...agent.env } } : {}),
    });
    c.child = child;
    c.token = randomBytes(24).toString("hex");
    c.toolCalls.clear();
    child.stderr?.setEncoding("utf8").on("data", (s: string) => {
      c.stderr = (c.stderr + s).slice(-KEEP_STDERR);
    });
    const exited = new Promise<never>((_, fail) => {
      child.once("error", (e) => fail(new AgentStartError("spawn", e.message)));
      child.once("exit", (code) =>
        fail(new AgentStartError("spawn", `exited with ${code}: ${c.stderr.trim()}`, `exited with ${code}`)),
      );
    });
    exited.catch(() => {});
    child.stdin?.on("error", () => {});
    const conn = new ClientSideConnection(
      () => ({
        requestPermission: async (p) => {
          const remembered = c.toolCalls.get(p.toolCall.toolCallId);
          const call: ToolRequest = { ...p.toolCall };
          if (!call.title && !call.name && remembered?.title) call.title = remembered.title;
          let decision: Decision;
          try {
            decision = decide(call, this.opts.root);
          } catch {
            decision = "deny";
          }
          if (decision === "deny") {
            const title = call.title || (call as { name?: string }).name || undefined;
            c.emit({
              type: "tool",
              id: p.toolCall.toolCallId,
              ...(title ? { title } : {}),
              kind: p.toolCall.kind ?? remembered?.kind,
              status: "denied",
            });
          }
          return { outcome: permissionOutcome(p.options, decision) };
        },
        sessionUpdate: async (n) => this.onUpdate(c, n),
      }),
      ndJsonStream(
        Writable.toWeb(child.stdin as Writable) as WritableStream<Uint8Array>,
        Readable.toWeb(child.stdout as Readable) as ReadableStream<Uint8Array>,
      ),
    );
    c.conn = conn;
    let timer: NodeJS.Timeout | undefined;
    try {
      const timeout = new Promise<never>((_, fail) => {
        timer = setTimeout(
          () => fail(new AgentStartError("protocol", "the agent did not answer within 2 minutes")),
          START_TIMEOUT_MS,
        );
      });
      await Promise.race([handshake(), exited, timeout]);
      if (this.closed) throw new AgentStartError("spawn", "yamlite is shutting down");
      if (c.child !== child) throw new Superseded();
    } catch (e) {
      if (c.child !== child && !this.closed) {
        child.kill();
        throw new Superseded();
      }
      if (c.child === child) {
        c.child = null;
        c.conn = null;
      }
      c.replaying = false;
      child.kill();
      if (this.closed) throw new AgentStartError("spawn", "yamlite is shutting down");
      throw e instanceof AgentStartError || e instanceof HttpError ? e : this.startError(e, c);
    } finally {
      clearTimeout(timer);
    }
    const onExit = () => {
      if (c.child !== child) return;
      c.child = null;
      c.conn = null;
      this.idle(c);
      c.emit({ type: "error", message: STOPPED_MESSAGE, detail: tail(c.stderr) });
      this.watchIdle(c);
    };
    child.on("error", () => {});
    if (child.exitCode !== null || child.signalCode !== null) onExit();
    else child.on("exit", onExit);
  }

  private mcpServers(c: Conversation) {
    return [
      {
        type: "http" as const,
        name: "yamlite",
        url: this.opts.mcpUrl(),
        headers: [{ name: "Authorization", value: `Bearer ${c.token}` }],
      },
    ];
  }

  private async initialize(c: Conversation) {
    const init = await (c.conn as ClientSideConnection).initialize({
      protocolVersion: PROTOCOL_VERSION,
      clientCapabilities: { fs: { readTextFile: false, writeTextFile: false }, terminal: false },
    });
    if (init.agentCapabilities?.mcpCapabilities?.http !== true) {
      throw new AgentStartError("protocol", `${c.agent.name} cannot use an HTTP MCP server`);
    }
    return init;
  }

  private async open(c: Conversation): Promise<void> {
    await this.initialize(c);
    const session = await (c.conn as ClientSideConnection).newSession({
      ...(c.agent.sessionMeta ? { _meta: c.agent.sessionMeta } : {}),
      cwd: this.opts.root,
      mcpServers: this.mcpServers(c),
    });
    c.sessionId = session.sessionId;
    await this.ensureMode(c, session.modes);
  }

  private async resume(c: Conversation): Promise<void> {
    const conn = c.conn as ClientSideConnection;
    const caps = (await this.initialize(c)).agentCapabilities;
    const params = {
      ...(c.agent.sessionMeta ? { _meta: c.agent.sessionMeta } : {}),
      sessionId: c.sessionId,
      cwd: this.opts.root,
      mcpServers: this.mcpServers(c),
    };
    let modes: SessionModeState | null | undefined;
    if (caps?.sessionCapabilities?.resume) {
      modes = (await conn.resumeSession(params)).modes;
    } else if (caps?.loadSession) {
      c.replaying = true;
      try {
        modes = (await conn.loadSession(params)).modes;
      } finally {
        c.replaying = false;
      }
    } else {
      throw new AgentStartError("protocol", `${c.agent.name} cannot resume a conversation`);
    }
    await this.ensureMode(c, modes);
  }

  private async ensureMode(c: Conversation, modes: SessionModeState | null | undefined): Promise<void> {
    const expected = c.agent.mode;
    if (!expected) return;
    c.mode = undefined;
    await (c.conn as ClientSideConnection).setSessionMode({ sessionId: c.sessionId, modeId: expected });
    // an adapter reports a mode it fell back to; no report means the requested one took
    const current = c.mode ?? expected;
    if (modes && current !== expected) {
      throw new AgentStartError("protocol", `${c.agent.name} stayed in mode ${current} instead of ${expected}`);
    }
  }

  private onUpdate(c: Conversation, n: SessionNotification): void {
    const u = n.update;
    if (u.sessionUpdate === "current_mode_update") {
      c.mode = u.currentModeId;
    } else if (c.replaying) {
      return;
    } else if (u.sessionUpdate === "agent_message_chunk" && u.content.type === "text") {
      c.emit({ type: "text", text: u.content.text });
    } else if (u.sessionUpdate === "tool_call" || u.sessionUpdate === "tool_call_update") {
      const prev = c.toolCalls.get(u.toolCallId) ?? {};
      c.toolCalls.set(u.toolCallId, {
        title: u.title || prev.title,
        kind: u.kind ?? prev.kind,
        locations: u.locations ?? prev.locations,
      });
      c.emit({
        type: "tool",
        id: u.toolCallId,
        ...(u.title ? { title: u.title } : {}),
        ...(u.kind !== undefined ? { kind: u.kind } : {}),
        ...(u.status !== undefined ? { status: u.status } : {}),
        ...(u.rawInput !== undefined ? { input: u.rawInput } : {}),
      });
    }
  }

  private startError(e: unknown, c: Conversation): AgentStartError {
    const code = (e as { code?: number }).code;
    const text = e instanceof Error ? e.message : ((e as { message?: string }).message ?? JSON.stringify(e));
    return code === AUTH_REQUIRED
      ? new AgentStartError("login", text)
      : new AgentStartError("protocol", `${text} ${c.stderr.trim()}`.trim(), text);
  }

  private mustGet(id: string): Conversation {
    const c = this.conversations.get(id);
    if (!c) throw new HttpError(404, `unknown conversation: ${id}`);
    return c;
  }

  private watchIdle(c: Conversation): void {
    clearTimeout(c.reaper);
    c.reaper = undefined;
    if (!c.child || c.busy || c.subscribers > 0) return;
    c.reaper = setTimeout(() => {
      if (this.conversations.get(c.id) === c && !c.busy) this.halt(c).catch(() => {});
    }, this.opts.idleMs ?? IDLE_MS);
    c.reaper.unref();
  }

  // drops the oldest stopped conversations so that one more fits; running ones always stay
  private evict(): void {
    const max = this.opts.maxConversations ?? MAX_CONVERSATIONS;
    const stopped = [...this.conversations.values()]
      .filter((c) => !c.child && !c.busy && c.subscribers === 0)
      .sort((a, b) => a.updatedAt - b.updatedAt);
    while (this.conversations.size >= max && stopped.length > 0) {
      const c = stopped.shift() as Conversation;
      this.conversations.delete(c.id);
      this.opts.feedback(c.id);
    }
  }

  private async halt(c: Conversation): Promise<void> {
    const child = c.child;
    c.child = null;
    c.conn = null;
    this.idle(c);
    if (!child || child.exitCode !== null || child.signalCode !== null) return;
    const gone = new Promise<void>((r) => child.once("exit", () => r()));
    child.kill("SIGTERM");
    const force = setTimeout(() => child.kill("SIGKILL"), 3000);
    await gone;
    clearTimeout(force);
  }
}
