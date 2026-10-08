import { act, fireEvent, render, renderHook, screen } from "@testing-library/react";
import { afterEach, expect, test, vi } from "vitest";
import { agentPanel, useAgentPanelOpen, type AgentMeta } from "@/lib/agent";
import { openCommandMenu } from "@/lib/commandMenu";
import type { GitState } from "@/lib/git";
import { MobileNav } from "./MobileNav";

let pathname = "/t/tasks";
vi.mock("@tanstack/react-router", () => ({
  useRouterState: ({ select }: { select: (s: unknown) => unknown }) => select({ location: { pathname }, matches: [] }),
}));
let agents: AgentMeta[] = [];
vi.mock("@/lib/agent", async (orig) => ({
  ...(await orig<typeof import("@/lib/agent")>()),
  useAgents: () => agents,
}));
let gitState: GitState | null = null;
vi.mock("@/lib/git", async (orig) => ({
  ...(await orig<typeof import("@/lib/git")>()),
  useGit: () => gitState,
}));
vi.mock("./ReviewDialog", () => ({
  ReviewDialog: ({ open }: { open: boolean }) => (open ? <div role="dialog" aria-label="review" /> : null),
}));
afterEach(() => {
  agents = [];
  gitState = null;
  act(() => agentPanel.close());
});
vi.mock("@/lib/providers", () => ({ useMeta: () => ({ data: { pages: [] } }) }));
vi.mock("@/lib/commandMenu", () => ({ openCommandMenu: vi.fn() }));
vi.mock("./Sidebar", () => ({
  Sidebar: ({ onSearch }: { onSearch?: () => void }) => (
    <aside aria-label="sidebar">
      <a href="#/t/tasks">tasks</a>
      <button type="button" onClick={onSearch}>
        Search…
      </button>
    </aside>
  ),
}));

test("shows the screen's name; a link in the sidebar sheet closes it, even to the screen already open", () => {
  render(<MobileNav onNewTable={() => {}} />);
  expect(screen.getByRole("heading", { name: "tasks" })).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: "menu" }));
  expect(screen.getByRole("complementary", { name: "sidebar" })).toBeTruthy();
  fireEvent.click(screen.getByRole("link", { name: "tasks" }));
  expect(screen.queryByRole("complementary", { name: "sidebar" })).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: "search" }));
  expect(openCommandMenu).toHaveBeenCalled();
});

test("a long name truncates instead of widening the bar", () => {
  pathname = `/t/${"x".repeat(200)}`;
  render(<MobileNav onNewTable={() => {}} />);
  expect(screen.getByRole("heading").className).toContain("truncate");
});

test("search from the sidebar sheet closes the sheet", () => {
  render(<MobileNav onNewTable={() => {}} />);
  fireEvent.click(screen.getByRole("button", { name: "menu" }));
  fireEvent.click(screen.getByRole("button", { name: "Search…" }));
  expect(screen.queryByRole("complementary", { name: "sidebar" })).toBeNull();
});

test("the AI button shows only when an agent exists and opens the panel", () => {
  agents = [{ id: "claude", name: "Claude Code", login: "claude" }];
  render(<MobileNav onNewTable={() => {}} />);
  const { result } = renderHook(() => useAgentPanelOpen());
  fireEvent.click(screen.getByRole("button", { name: "Ask AI" }));
  expect(result.current).toBe(true);
});

test("no AI button without agents", () => {
  render(<MobileNav onNewTable={() => {}} />);
  expect(screen.queryByRole("button", { name: "Ask AI" })).toBeNull();
});

test("the review button shows the number of changes and opens the dialog", () => {
  gitState = {
    branch: "main",
    defaultBranch: "main",
    upstream: "origin/main",
    changes: [
      { path: "tasks/a.yaml", status: "modified", table: "tasks", records: null },
      { path: "tasks/b.yaml", status: "added", table: "tasks", records: null },
    ],
  };
  render(<MobileNav onNewTable={() => {}} />);
  const button = screen.getByRole("button", { name: /2/ });
  expect(button.textContent).toBe("2");
  fireEvent.click(button);
  expect(screen.getByRole("dialog", { name: "review" })).toBeTruthy();
});

test("no review button without changes or outside git", () => {
  gitState = { branch: "main", defaultBranch: "main", upstream: null, changes: [] };
  const { unmount } = render(<MobileNav onNewTable={() => {}} />);
  expect(screen.getAllByRole("button").map((b) => b.getAttribute("aria-label"))).toEqual(["menu", "search"]);
  unmount();
  gitState = null;
  render(<MobileNav onNewTable={() => {}} />);
  expect(screen.getAllByRole("button")).toHaveLength(2);
});
