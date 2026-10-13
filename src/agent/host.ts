import { randomBytes } from "node:crypto";
import { APICallError, jsonSchema, type LanguageModel, type ModelMessage, stepCountIs, streamText, tool } from "ai";
import { HttpError } from "../serve/http.ts";
import { type Credentials, createModel, PROVIDERS, providerOf } from "./providers.ts";
import type { AgentEvent, ConversationSummary } from "./types.ts";
import { type AgentTool, toolText } from "./tools.ts";

const MAX_CONVERSATIONS = 20;
const MAX_STEPS = 20;
const TITLE_LENGTH = 30;

const PREAMBLE = `You are helping a user look up and edit the data in a YAMLite folder (YAML files kept in sync with SQLite).
Use your tools: start with schema, read with query and get_records.
You cannot write files or run commands. To change data, call propose_changes, propose_sql or propose_table: they only create a proposal. The proposal appears as a card in this same chat panel, and the user applies it there with the card's apply button ("N 件を適用"). After creating one, tell the user to review the card above and press its apply button; do not send them elsewhere in the UI. Never say data was changed until you are told it was applied.
For questions about the schema, yamlite.yaml or how to structure data, read the guide tool first. Its workflow is for explaining: you cannot run YAMLite commands or edit yamlite.yaml; propose_table is the only schema change you can propose.
Reply in the language the user writes in, briefly and without SQL unless they ask for it.`;

export const GIT_NOTE = `The data folder is in a git repository. Read it with git_status, git_diff, git_log and git_branches. To branch, commit, push, open a pull request or switch branches, call propose_git with the steps in order; like other proposals it runs only when the user presses the card's button ("Run N steps" / "N 件の手順を実行"). Read git_status first and choose the files to commit yourself: only files related to what the user asked. Pull requests are created as drafts. In the proposal title or your reply, say what the user will see afterwards, e.g. that switching back to the default branch hides the committed changes until the PR is merged and pulled, and that uncommitted changes stay as they are.`;

export const GIT_DONE = `The git steps you proposed have finished; their result is above. Tell the user briefly what happened, with the pull request link if there is one. If a step failed, say what to do next.`;

const titleOf = (text: string) => {
  const t = text.replace(/\s+/g, " ").trim();
  return t.length > TITLE_LENGTH ? `${t.slice(0, TITLE_LENGTH)}…` : t;
};

const errorEvent = (e: unknown): AgentEvent =>
  APICallError.isInstance(e) && (e.statusCode === 401 || e.statusCode === 403)
    ? { type: "error", code: "auth", message: e.message }
    : { type: "error", message: e instanceof Error ? e.message : String(e) };

export class Conversation {
  readonly events: AgentEvent[] = [];
  readonly messages: ModelMessage[] = [];
  busy = false;
  title = "";
  updatedAt = Date.now();
  abort: AbortController | null = null;
  // feedback taken by a turn that failed, so the next turn passes it on
  carry: string[] = [];
  private readonly listeners = new Set<(e: AgentEvent) => void>();

  constructor(
    readonly id: string,
    readonly provider: string,
    readonly modelId: string,
    readonly model: LanguageModel,
  ) {}

  get subscribers(): number {
    return this.listeners.size;
  }

  summary(): ConversationSummary {
    return {
      id: this.id,
      provider: this.provider,
      model: this.modelId,
      title: this.title,
      updatedAt: new Date(this.updatedAt).toISOString(),
    };
  }

  subscribe(fn: (e: AgentEvent) => void): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  emit(e: AgentEvent): void {
    this.events.push(e);
    this.updatedAt = Date.now();
    if (e.type === "user" && !this.title) this.title = titleOf(e.text);
    for (const fn of this.listeners) fn(e);
  }
}

export interface StartInput {
  provider: unknown;
  model?: unknown;
  apiKey?: unknown;
}

export interface HostOptions {
  tools: (conversationId: string) => AgentTool[];
  // what happened since the model last heard from the user (applied proposals, git results), taken once
  feedback: (conversationId: string) => string[];
  // appended to the preamble
  notes?: string[];
  // keys the host holds itself, by provider id; yamlite serve reads them from the environment
  keys?: Record<string, string>;
  createModel?: (c: Credentials) => LanguageModel;
  maxConversations?: number;
  maxSteps?: number;
}

export class AgentHost {
  private readonly conversations = new Map<string, Conversation>();
  private closed = false;

  constructor(private readonly opts: HostOptions) {}

  providers(): { id: string; name: string; models: string[]; hasKey: boolean }[] {
    return PROVIDERS.map((p) => ({
      id: p.id,
      name: p.name,
      models: [...p.models],
      hasKey: Boolean(this.opts.keys?.[p.id]),
    }));
  }

  start(input: StartInput): Conversation {
    if (this.closed) throw new HttpError(503, "YAMLite is shutting down");
    const p = providerOf(input.provider);
    if (input.model !== undefined && typeof input.model !== "string")
      throw new HttpError(400, "model must be a string");
    // any model id goes through: the provider rejects one it does not have
    const model = input.model?.trim() || (p.models[0] as string);
    const given = typeof input.apiKey === "string" ? input.apiKey.trim() : "";
    const apiKey = given || this.opts.keys?.[p.id];
    if (!apiKey) throw new HttpError(400, `an API key for ${p.name} is required`, { code: "no_key" });
    const make = this.opts.createModel ?? createModel;
    const c = new Conversation(randomBytes(8).toString("hex"), p.id, model, make({ provider: p.id, model, apiKey }));
    this.evict();
    this.conversations.set(c.id, c);
    return c;
  }

  get(id: string): Conversation | undefined {
    return this.conversations.get(id);
  }

  list(): ConversationSummary[] {
    // reversed first so that conversations updated in the same millisecond list the newer one first
    return [...this.conversations.values()]
      .reverse()
      .sort((a, b) => b.updatedAt - a.updatedAt)
      .map((c) => c.summary());
  }

  prompt(id: string, text: string): void {
    const c = this.mustGet(id);
    if (c.busy) throw new HttpError(409, "the agent is busy with the previous message");
    c.emit({ type: "user", text });
    this.turn(c, text);
  }

  // a turn the user did not type, so that the model reports what just happened (e.g. git steps that ran);
  // a busy conversation gets the queued feedback with its next prompt instead
  notify(id: string, text: string): void {
    const c = this.conversations.get(id);
    if (!c || c.busy) return;
    this.turn(c, text);
  }

  cancel(id: string): void {
    this.mustGet(id).abort?.abort();
  }

  end(id: string): void {
    const c = this.mustGet(id);
    this.conversations.delete(id);
    c.abort?.abort();
    this.opts.feedback(id);
    c.emit({ type: "closed" });
  }

  publish(conversationId: string, e: AgentEvent): void {
    this.conversations.get(conversationId)?.emit(e);
  }

  async close(): Promise<void> {
    this.closed = true;
    for (const c of this.conversations.values()) c.abort?.abort();
    this.conversations.clear();
  }

  private turn(c: Conversation, text: string): void {
    c.busy = true;
    c.emit({ type: "busy", busy: true });
    const before = c.messages.length;
    const lead = c.carry;
    c.carry = [];
    const abort = new AbortController();
    c.abort = abort;
    void (async () => {
      try {
        lead.push(...this.opts.feedback(c.id));
        c.messages.push({ role: "user", content: [...lead, text].join("\n") });
        return await this.run(c, abort.signal);
      } catch (e) {
        c.emit(errorEvent(e));
        return false;
      }
    })()
      .then((done) => {
        // an aborted or failed turn would leave a dangling question or tool call in the history
        if (!done) {
          c.messages.length = before;
          c.carry = lead;
        }
      })
      .finally(() => {
        c.abort = null;
        c.busy = false;
        c.emit({ type: "busy", busy: false });
      });
  }

  private async run(c: Conversation, signal: AbortSignal): Promise<boolean> {
    try {
      const tools = Object.fromEntries(
        this.opts.tools(c.id).map((t) => [
          t.name,
          tool({
            description: t.description,
            inputSchema: jsonSchema(t.inputSchema as Parameters<typeof jsonSchema>[0]),
            execute: async (args: unknown) => toolText(await t.call((args ?? {}) as Record<string, unknown>)),
          }),
        ]),
      );
      const r = streamText({
        model: c.model,
        system: [PREAMBLE, ...(this.opts.notes ?? [])].join("\n"),
        messages: [...c.messages],
        tools,
        stopWhen: stepCountIs(this.opts.maxSteps ?? MAX_STEPS),
        abortSignal: signal,
        // errors arrive as stream parts below; the default handler would also print them
        onError: () => {},
      });
      for await (const p of r.fullStream) {
        switch (p.type) {
          case "text-delta":
            c.emit({ type: "text", text: p.text });
            break;
          case "tool-call":
            c.emit({ type: "tool", id: p.toolCallId, title: p.toolName, status: "in_progress", input: p.input });
            break;
          case "tool-result":
            c.emit({ type: "tool", id: p.toolCallId, status: "completed" });
            break;
          case "tool-error":
            c.emit({ type: "tool", id: p.toolCallId, status: "failed" });
            break;
          case "abort":
            return false;
          case "error":
            c.emit(errorEvent(p.error));
            return false;
        }
      }
      c.messages.push(...(await r.responseMessages));
      return true;
    } catch (e) {
      if (!signal.aborted) c.emit(errorEvent(e));
      return false;
    }
  }

  private mustGet(id: string): Conversation {
    const c = this.conversations.get(id);
    if (!c) throw new HttpError(404, `unknown conversation: ${id}`);
    return c;
  }

  // drops the oldest idle conversations so that one more fits; busy or watched ones always stay
  private evict(): void {
    const max = this.opts.maxConversations ?? MAX_CONVERSATIONS;
    const idle = [...this.conversations.values()]
      .filter((c) => !c.busy && c.subscribers === 0)
      .sort((a, b) => a.updatedAt - b.updatedAt);
    while (this.conversations.size >= max && idle.length > 0) {
      const c = idle.shift() as Conversation;
      this.conversations.delete(c.id);
      this.opts.feedback(c.id);
    }
  }
}
