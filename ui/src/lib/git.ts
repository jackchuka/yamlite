import { useQuery } from "@tanstack/react-query";
import { api, request } from "./api";
import type { Row } from "./types";
import { isReadOnly } from "./mode";

export type ChangeKind = "added" | "modified" | "deleted";

export interface RecordChange {
  key: string;
  kind: ChangeKind;
  // the top-level fields that changed; empty when the record came or went, or only its formatting changed
  fields: string[];
}

export interface GitChange {
  path: string;
  status: ChangeKind;
  table: string | null;
  // null for files that are not records (yamlite.yaml, pages) or that cannot be read
  records: RecordChange[] | null;
}

export interface FieldValues {
  field: string;
  from: unknown;
  to: unknown;
}

export interface Reverted {
  table: string;
  key: string;
  before: Row | null;
  after: Row | null;
}

export interface GitState {
  branch: string | null;
  defaultBranch: string | null;
  upstream: string | null;
  changes: GitChange[];
}

export interface StepResult {
  status: "done" | "failed" | "skipped";
  message?: string;
}

export interface ReviewResult {
  branch: string;
  steps: string[];
  results: StepResult[];
  url: string | null;
  created: boolean;
  error?: string;
}

export const GIT_KEY = ["git"];

export const gitApi = {
  state: () => request<{ git: GitState | null }>("GET", "/api/git").then((r) => r.git),
  review: (body: { title: string; body: string; paths: string[] }) =>
    request<ReviewResult>("POST", "/api/git/review", body),
  diff: (path: string) =>
    request<{ records: Array<{ key: string; kind: ChangeKind; fields: FieldValues[] }> }>(
      "GET",
      `/api/git/diff?path=${encodeURIComponent(path)}`,
    ),
  revert: (records: Array<{ table: string; key: string; delete?: boolean }>) =>
    request<{ reverted: Reverted[] }>("POST", "/api/git/revert", { records }),
};

// puts reverted records back the way they were before the revert, through the same writes as the forms
export async function undoRevert(items: Reverted[]): Promise<void> {
  for (const { table, key, before, after } of items) {
    if (before === null) await api.remove(table, key);
    else if (after === null) await api.create(table, key, before);
    else {
      const cleared = Object.fromEntries(
        Object.keys(after)
          .filter((f) => !(f in before))
          .map((f) => [f, null]),
      );
      await api.update(table, key, { ...cleared, ...before }, after);
    }
  }
}

// null outside a git repository with an origin, and in the static export
export function useGit(): GitState | null {
  const enabled = !isReadOnly();
  return useQuery({ queryKey: GIT_KEY, queryFn: gitApi.state, enabled, refetchOnWindowFocus: true }).data ?? null;
}

// the changes grouped by table; files outside every table (yamlite.yaml, pages) come last under null
export function groupChanges(changes: GitChange[]): Array<{ table: string | null; changes: GitChange[] }> {
  const groups = new Map<string | null, GitChange[]>();
  for (const c of changes) groups.set(c.table, [...(groups.get(c.table) ?? []), c]);
  return [...groups.entries()]
    .sort(([a], [b]) => (a === null ? 1 : b === null ? -1 : a.localeCompare(b)))
    .map(([table, changes]) => ({ table, changes }));
}
