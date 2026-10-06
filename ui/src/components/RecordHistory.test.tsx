import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, expect, test, vi } from "vitest";
import { api } from "@/lib/api";
import { useRecordHistory } from "@/lib/recordHistory";
import type { HistoryEntry, HistoryPage, Row } from "@/lib/types";
import { RecordHistory } from "./RecordHistory";

vi.mock("@/lib/api", async (orig) => ({
  ...(await orig<typeof import("@/lib/api")>()),
  api: { history: vi.fn(), historyDiff: vi.fn() },
}));
afterEach(cleanup);

const sha = "a3f9c21".padEnd(40, "0");
const commit: HistoryEntry = {
  kind: "commit",
  sha,
  head: true,
  subject: "Add docs tag",
  author: "alice",
  date: "2026-10-06T00:00:00Z",
  path: "tasks/a.yaml",
  changes: [{ path: "priority", from: 2, to: 1 }],
  record: { title: "A", priority: 1 },
};
const wip: HistoryEntry = { ...commit, kind: "wip", sha: null, head: false, subject: null, author: null };

function Harness(props: { current: Row; onRestore?: (r: Row, s: string) => void; canRestore?: boolean }) {
  const query = useRecordHistory("tasks", "a", true);
  return (
    <RecordHistory
      table="tasks"
      recordKey="a"
      query={query}
      current={props.current}
      keyColumn="id"
      canRestore={props.canRestore ?? true}
      onRestore={props.onRestore ?? (() => {})}
    />
  );
}
const show = (
  page: HistoryPage,
  props: Parameters<typeof Harness>[0] = { current: { id: "a", title: "A", priority: 3 } },
) => {
  vi.mocked(api.history).mockResolvedValue(page);
  render(
    <QueryClientProvider client={new QueryClient()}>
      <Harness {...props} />
    </QueryClientProvider>,
  );
};

test("lists uncommitted changes and commits", async () => {
  show({ state: "ok", entries: [wip, commit], next: null });
  expect(await screen.findByText("Uncommitted changes")).toBeTruthy();
  expect(screen.getByText("Add docs tag")).toBeTruthy();
  expect(screen.getByText("HEAD")).toBeTruthy();
  expect(screen.getByText("a3f9c21")).toBeTruthy();
});

test("expanding shows field changes, and YAML diff on request", async () => {
  vi.mocked(api.historyDiff).mockResolvedValue({ text: "-priority: 2\n+priority: 1\n" });
  show({ state: "ok", entries: [commit], next: null });
  fireEvent.click(await screen.findByRole("button", { name: /Add docs tag/ }));
  expect(screen.getByText("2")).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: "YAML diff" }));
  expect(await screen.findByText("+priority: 1")).toBeTruthy();
  expect(api.historyDiff).toHaveBeenCalledWith("tasks", "a", sha);
});

test("restore hands the version's record and sha to the drawer", async () => {
  const onRestore = vi.fn();
  show({ state: "ok", entries: [commit], next: null }, { current: { id: "a", title: "A", priority: 3 }, onRestore });
  fireEvent.click(await screen.findByRole("button", { name: /Add docs tag/ }));
  fireEvent.click(screen.getByRole("button", { name: "Restore this version" }));
  expect(onRestore).toHaveBeenCalledWith(commit.record, sha);
});

test("restore is disabled when the version equals the current values", async () => {
  show({ state: "ok", entries: [commit], next: null }, { current: { id: "a", title: "A", priority: 1 } });
  fireEvent.click(await screen.findByRole("button", { name: /Add docs tag/ }));
  expect(screen.getByRole("button", { name: "Restore this version" }).hasAttribute("disabled")).toBe(true);
});

test("an unreadable version shows its YAML diff", async () => {
  vi.mocked(api.historyDiff).mockResolvedValue({ text: "-title: A\n+title: [\n" });
  show({
    state: "ok",
    entries: [{ ...commit, subject: "break", unreadable: true, changes: [], record: null }],
    next: null,
  });
  fireEvent.click(await screen.findByRole("button", { name: /break/ }));
  expect(screen.getByText("This version can't be read")).toBeTruthy();
  expect(await screen.findByText("+title: [")).toBeTruthy();
});

test("empty states", async () => {
  show({ state: "nogit" });
  expect(await screen.findByText("No git history")).toBeTruthy();
  cleanup();
  show({ state: "untracked" });
  expect(await screen.findByText("Not committed yet")).toBeTruthy();
  cleanup();
  show({ state: "error", message: "git log timed out" });
  expect(await screen.findByText("git log timed out")).toBeTruthy();
});

test("loads older pages", async () => {
  vi.mocked(api.history)
    .mockResolvedValueOnce({ state: "ok", entries: [commit], next: "50" })
    .mockResolvedValueOnce({
      state: "ok",
      entries: [{ ...commit, sha: "b".repeat(40), subject: "Older" }],
      next: null,
    });
  render(
    <QueryClientProvider client={new QueryClient()}>
      <Harness current={{ id: "a" }} />
    </QueryClientProvider>,
  );
  fireEvent.click(await screen.findByRole("button", { name: "Load older history" }));
  expect(await screen.findByText("Older")).toBeTruthy();
  await waitFor(() => expect(api.history).toHaveBeenLastCalledWith("tasks", "a", "50"));
  expect(screen.queryByRole("button", { name: "Load older history" })).toBeNull();
});
