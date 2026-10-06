import { act, fireEvent, render, renderHook, screen } from "@testing-library/react";
import { afterEach, expect, test, vi } from "vitest";
import { agentPanel, useAgentPanelOpen, type AgentMeta } from "@/lib/agent";
import { openCommandMenu } from "@/lib/commandMenu";
import { setMobile } from "@/test/media";
import { CommandMenu } from "./CommandMenu";

vi.mock("@tanstack/react-router", () => ({ useNavigate: () => vi.fn() }));
// cmdk measures its list
globalThis.ResizeObserver ??= class {
  observe() {}
  unobserve() {}
  disconnect() {}
} as unknown as typeof ResizeObserver;
Element.prototype.scrollIntoView ??= () => {};

let agents: AgentMeta[] = [];
vi.mock("@/lib/agent", async (orig) => ({
  ...(await orig<typeof import("@/lib/agent")>()),
  useAgents: () => agents,
}));
afterEach(() => {
  agents = [];
  act(() => agentPanel.close());
});
vi.mock("@/lib/providers", () => ({ useMeta: () => ({ data: { tables: [], views: [], pages: [] } }) }));

test("on a phone the search text keeps clear of the close button and the list fills the screen", () => {
  act(() => setMobile(true));
  render(<CommandMenu />);
  act(() => openCommandMenu());
  expect(screen.getByRole("combobox").className).toContain("max-md:pr-10");
  expect(screen.getByRole("listbox").className).toContain("max-md:max-h-none");
});

test("the AI item shows only when an agent exists and opens the panel", () => {
  agents = [{ id: "claude", name: "Claude Code", login: "claude" }];
  render(<CommandMenu />);
  const { result } = renderHook(() => useAgentPanelOpen());
  act(() => openCommandMenu());
  fireEvent.click(screen.getByRole("option", { name: "AI に依頼" }));
  expect(result.current).toBe(true);
});

test("no AI item without agents", () => {
  render(<CommandMenu />);
  act(() => openCommandMenu());
  expect(screen.queryByRole("option", { name: "AI に依頼" })).toBeNull();
});
