import { act, fireEvent, render, renderHook, screen } from "@testing-library/react";
import { afterEach, expect, test, vi } from "vitest";
import { agentPanel, useAgentPanelOpen, type AgentMeta } from "@/lib/agent";
import { openCommandMenu } from "@/lib/commandMenu";
import { MobileNav } from "./MobileNav";

let pathname = "/t/tasks";
vi.mock("@tanstack/react-router", () => ({
  useRouterState: ({ select }: { select: (s: unknown) => unknown }) => select({ location: { pathname } }),
}));
let agents: AgentMeta[] = [];
vi.mock("@/lib/agent", async (orig) => ({
  ...(await orig<typeof import("@/lib/agent")>()),
  useAgents: () => agents,
}));
afterEach(() => {
  agents = [];
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
  fireEvent.click(screen.getByRole("button", { name: "AI に依頼" }));
  expect(result.current).toBe(true);
});

test("no AI button without agents", () => {
  render(<MobileNav onNewTable={() => {}} />);
  expect(screen.queryByRole("button", { name: "AI に依頼" })).toBeNull();
});
