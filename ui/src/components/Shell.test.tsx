import { act, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, test, vi } from "vitest";
import { agentPanel, type AgentMeta } from "@/lib/agent";
import { Shell } from "./Shell";

let agents: AgentMeta[] = [];
vi.mock("@/lib/agent", async (orig) => ({
  ...(await orig<typeof import("@/lib/agent")>()),
  useAgents: () => agents,
}));
vi.mock("@tanstack/react-router", () => ({ Outlet: () => <div>outlet</div> }));
vi.mock("@/lib/providers", () => ({ useEvents: () => ({ configError: null }) }));
vi.mock("@/lib/useIsMobile", () => ({ useIsMobile: () => false }));
vi.mock("@/components/ui/sonner", () => ({ Toaster: () => null }));
vi.mock("./CommandMenu", () => ({ CommandMenu: () => null }));
vi.mock("./SessionBanner", () => ({ SessionBanner: () => null }));
vi.mock("./ConflictToasts", () => ({ ConflictToasts: () => null }));
vi.mock("./NewTableDialog", () => ({ NewTableDialog: () => null }));
vi.mock("./MobileNav", () => ({ MobileNav: () => null }));
vi.mock("./Sidebar", () => ({ Sidebar: () => null }));
vi.mock("./StatusBar", () => ({ StatusBar: () => null }));
vi.mock("./AgentPanel", () => ({ AgentPanel: () => <aside aria-label="Ask AI" /> }));

afterEach(() => {
  agents = [];
  act(() => agentPanel.close());
});

test("the panel docks beside the screen when open and an agent exists", () => {
  agents = [{ id: "claude", name: "Claude Code", login: "claude" }];
  act(() => agentPanel.open());
  render(<Shell />);
  expect(screen.getByText("outlet")).toBeTruthy();
  expect(screen.getByRole("complementary", { name: "Ask AI" })).toBeTruthy();
});

test("no panel without agents, even when open", () => {
  act(() => agentPanel.open());
  render(<Shell />);
  expect(screen.queryByRole("complementary", { name: "Ask AI" })).toBeNull();
});

test("dragging the sidebar's right edge widens it and the width is remembered", () => {
  localStorage.clear();
  render(<Shell />);
  const handle = screen.getByRole("separator", { name: "Resize sidebar" });
  const grid = handle.parentElement!.parentElement!;
  expect(grid.style.gridTemplateColumns).toBe("220px 1fr");
  fireEvent.pointerDown(handle, { clientX: 220, button: 0 });
  fireEvent.pointerMove(document, { clientX: 300 });
  fireEvent.pointerUp(document, { clientX: 300 });
  expect(grid.style.gridTemplateColumns).toBe("300px 1fr");
  expect(localStorage.getItem("yamlite-sidebar-width")).toBe("300");
  fireEvent.keyDown(handle, { key: "ArrowLeft" });
  expect(grid.style.gridTemplateColumns).toBe("284px 1fr");
  fireEvent.doubleClick(handle);
  expect(grid.style.gridTemplateColumns).toBe("220px 1fr");
  expect(localStorage.getItem("yamlite-sidebar-width")).toBeNull();
});
