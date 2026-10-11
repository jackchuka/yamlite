import { useQuery } from "@tanstack/react-query";
import { useSyncExternalStore } from "react";
import { type AiChoice, useAiProviders } from "./ai";
import { request } from "./api";
import { transport } from "./transport";
import { queryClient } from "./providers";
import type { Row } from "./types";
import { m } from "@/paraglide/messages.js";

export type ProposalStatus = "pending" | "applied" | "discarded" | "stale" | "failed";

export interface ProposalRow {
  table: string;
  key: string;
  op: "insert" | "update" | "delete";
  before: Row | null;
  after: Row | null;
  changed: string[];
}

export type GitStep =
  | { kind: "create_branch"; name: string; from?: string }
  | { kind: "switch"; branch: string }
  | { kind: "commit"; message: string; paths: string[] }
  | { kind: "push"; branch: string }
  | { kind: "pull"; branch: string }
  | { kind: "open_pr"; title: string; body: string; base?: string };

export interface StepResult {
  status: "done" | "failed" | "skipped";
  message?: string;
  url?: string;
  created?: boolean;
}

export interface Proposal {
  id: string;
  conversationId: string;
  title: string;
  status: ProposalStatus;
  createdAt: string;
  rows: ProposalRow[];
  warnings: string[];
  table?: { name: string; mode: string; key: string; columns: Record<string, string> };
  git?: { steps: GitStep[]; startBranch: string | null; results: StepResult[] };
  sql?: string;
  stale?: string[];
  error?: string;
}

export type AgentEvent =
  | { type: "user"; text: string }
  | { type: "text"; text: string }
  | { type: "tool"; id: string; title?: string; kind?: string | null; status?: string | null; input?: unknown }
  | { type: "proposal"; proposal: Proposal }
  | { type: "busy"; busy: boolean }
  | { type: "error"; message: string; code?: "auth" }
  | { type: "closed"; message?: string };

export interface ConversationSummary {
  id: string;
  provider: string;
  model: string;
  title: string;
  updatedAt: string;
}

export type ChatItem =
  | { kind: "user"; text: string }
  | { kind: "agent"; text: string }
  | { kind: "tool"; id: string; title: string; status: string | null; input?: unknown }
  | { kind: "proposal"; proposal: Proposal }
  | { kind: "error"; message: string; code?: "auth" };

export interface ChatState {
  items: ChatItem[];
  busy: boolean;
  closed: boolean;
}

export const EMPTY_CHAT: ChatState = { items: [], busy: false, closed: false };

export function reduceChat(s: ChatState, e: AgentEvent): ChatState {
  const items = s.items;
  switch (e.type) {
    case "user":
      return { ...s, items: [...items, { kind: "user", text: e.text }] };
    case "text": {
      const last = items.at(-1);
      if (last?.kind === "agent")
        return { ...s, items: [...items.slice(0, -1), { kind: "agent", text: last.text + e.text }] };
      return { ...s, items: [...items, { kind: "agent", text: e.text }] };
    }
    case "tool": {
      const i = items.findIndex((x) => x.kind === "tool" && x.id === e.id);
      if (i < 0) {
        const item: ChatItem = {
          kind: "tool",
          id: e.id,
          title: e.title ?? e.id,
          status: e.status ?? null,
          ...(e.input !== undefined ? { input: e.input } : {}),
        };
        return { ...s, items: [...items, item] };
      }
      const old = items[i] as Extract<ChatItem, { kind: "tool" }>;
      const merged: ChatItem = {
        ...old,
        ...(e.title ? { title: e.title } : {}),
        ...(e.status !== undefined ? { status: e.status ?? null } : {}),
        ...(e.input !== undefined ? { input: e.input } : {}),
      };
      return { ...s, items: items.map((x, j) => (j === i ? merged : x)) };
    }
    case "proposal": {
      const i = items.findIndex((x) => x.kind === "proposal" && x.proposal.id === e.proposal.id);
      const item: ChatItem = { kind: "proposal", proposal: e.proposal };
      return { ...s, items: i < 0 ? [...items, item] : items.map((x, j) => (j === i ? item : x)) };
    }
    case "busy":
      return { ...s, busy: e.busy };
    case "error":
      return {
        ...s,
        items: [
          ...items,
          {
            kind: "error",
            message: e.code === "auth" ? m.agent_auth_failed() : e.message,
            ...(e.code ? { code: e.code } : {}),
          },
        ],
      };
    case "closed":
      return { ...s, busy: false, closed: true };
  }
}

const enc = encodeURIComponent;
const conv = (id: string) => `/api/agent/conversations/${enc(id)}`;

export const agentApi = {
  conversations: () => request<{ conversations: ConversationSummary[] }>("GET", "/api/agent/conversations"),
  start: (c: AiChoice) =>
    request<{ id: string }>("POST", "/api/agent/conversations", {
      provider: c.provider,
      model: c.model,
      ...(c.apiKey ? { apiKey: c.apiKey } : {}),
    }),
  prompt: (id: string, text: string) => request<{ ok: true }>("POST", `${conv(id)}/prompt`, { text }),
  cancel: (id: string) => request<{ ok: true }>("POST", `${conv(id)}/cancel`),
  proposals: () => request<{ proposals: Proposal[] }>("GET", "/api/agent/proposals"),
  apply: (id: string) => request<Proposal>("POST", `/api/agent/proposals/${enc(id)}/apply`),
  discard: (id: string) => request<Proposal>("POST", `/api/agent/proposals/${enc(id)}/discard`),
};

export interface RowPreview {
  op: "insert" | "update" | "delete";
  before: Row | null;
  after: Row | null;
  changed: string[];
}

export function previewFor(proposals: Proposal[], table: string): Map<string, RowPreview> {
  const out = new Map<string, RowPreview>();
  for (const p of proposals) {
    if (p.status !== "pending") continue;
    for (const r of p.rows)
      if (r.table === table) out.set(r.key, { op: r.op, before: r.before, after: r.after, changed: r.changed });
  }
  return out;
}

const SOURCE_CLOSED = 2;
const PROPOSALS_KEY = ["agent-proposals"];
const CONVERSATIONS_KEY = ["agent-conversations"];

export class Chat {
  state: ChatState = EMPTY_CHAT;
  id: string | null = null;
  private source: EventSource | null = null;
  private readonly listeners = new Set<() => void>();

  constructor(private readonly make: (url: string) => EventSource = (u) => transport().eventSource(u)) {}

  subscribe(fn: () => void): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  async start(c: AiChoice): Promise<void> {
    const { id } = await agentApi.start(c);
    this.open(id);
  }

  // shows a conversation; the server replays its history into the empty log
  open(id: string): void {
    void queryClient.invalidateQueries({ queryKey: CONVERSATIONS_KEY });
    this.source?.close();
    this.id = id;
    this.set(EMPTY_CHAT);
    const source = this.make(`${conv(id)}/events`);
    this.source = source;
    let opened = false;
    source.addEventListener("open", () => {
      if (this.source !== source) return;
      // the server replays every event on reconnect, so start from scratch
      if (opened) this.set(EMPTY_CHAT);
      opened = true;
    });
    source.addEventListener("agent", (m) => {
      if (this.source !== source) return;
      if (!(m instanceof MessageEvent) || typeof m.data !== "string") return;
      let e: AgentEvent;
      try {
        e = JSON.parse(m.data) as AgentEvent;
      } catch {
        return;
      }
      if (e.type === "proposal") void queryClient.invalidateQueries({ queryKey: PROPOSALS_KEY });
      this.set(reduceChat(this.state, e));
      if (e.type === "closed") this.disconnect(source);
    });
    source.addEventListener("error", () => {
      if (this.source !== source || source.readyState !== SOURCE_CLOSED) return;
      this.disconnect(source);
      if (!this.state.closed) {
        const failed = reduceChat(this.state, {
          type: "error",
          message: m.agent_disconnected(),
        });
        this.set(reduceChat(failed, { type: "closed" }));
      }
    });
  }

  async send(text: string): Promise<void> {
    if (this.id) await agentApi.prompt(this.id, text);
  }

  async stop(): Promise<void> {
    if (this.id) await agentApi.cancel(this.id);
  }

  // an empty chat; the previous conversation stays on the server and in the conversation list
  async reset(): Promise<void> {
    void queryClient.invalidateQueries({ queryKey: CONVERSATIONS_KEY });
    this.source?.close();
    this.source = null;
    this.id = null;
    this.set(EMPTY_CHAT);
  }

  private disconnect(source: EventSource): void {
    source.close();
    if (this.source === source) this.source = null;
  }

  private set(next: ChatState): void {
    this.state = next;
    for (const fn of this.listeners) fn();
  }
}

export const chat = new Chat();
export const useChat = (): ChatState =>
  useSyncExternalStore(
    (fn) => chat.subscribe(fn),
    () => chat.state,
  );

export function usePendingProposals(): Proposal[] {
  const enabled = useAiProviders() !== null;
  return useQuery({ queryKey: PROPOSALS_KEY, queryFn: agentApi.proposals, enabled }).data?.proposals ?? [];
}

export function useConversations(enabled: boolean): { conversations: ConversationSummary[]; loading: boolean } {
  const q = useQuery({ queryKey: CONVERSATIONS_KEY, queryFn: agentApi.conversations, enabled, staleTime: 0 });
  return { conversations: q.data?.conversations ?? [], loading: q.isPending };
}

export const invalidateProposals = () => queryClient.invalidateQueries({ queryKey: PROPOSALS_KEY });

let panelOpen = false;
const panelListeners = new Set<() => void>();
const setPanel = (next: boolean) => {
  panelOpen = next;
  for (const fn of panelListeners) fn();
};
export const agentPanel = {
  open: () => setPanel(true),
  close: () => setPanel(false),
  toggle: () => setPanel(!panelOpen),
};
export const useAgentPanelOpen = (): boolean =>
  useSyncExternalStore(
    (fn) => {
      panelListeners.add(fn);
      return () => panelListeners.delete(fn);
    },
    () => panelOpen,
  );
