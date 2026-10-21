// Node-free, so the UI can import them
import type { GitStep, StepResult } from "../git/types.ts";
import type { ColumnType, Rec } from "../types.ts";

export type ProposalStatus = "pending" | "applied" | "discarded" | "stale" | "failed";

export type RowOp = "insert" | "update" | "delete";

export interface ProposalRow {
  table: string;
  key: string;
  op: RowOp;
  before: Rec | null;
  after: Rec | null;
  changed: string[];
}

export interface NewTable {
  name: string;
  mode: "files" | "list";
  key: string;
  columns: Record<string, ColumnType>;
  group?: string;
}

export interface Proposal {
  id: string;
  conversationId: string;
  title: string;
  status: ProposalStatus;
  createdAt: string;
  rows: ProposalRow[];
  // rule warnings (required, values, formats, bounds) the proposal would add
  warnings: string[];
  table?: NewTable;
  sql?: string;
  git?: { steps: GitStep[]; startBranch: string | null; results: StepResult[] };
  stale?: string[];
  error?: string;
}

export type AgentEvent =
  | { type: "user"; text: string }
  | { type: "text"; text: string }
  | { type: "tool"; id: string; title?: string; status?: "in_progress" | "completed" | "failed"; input?: unknown }
  | { type: "source"; url: string; title?: string }
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
