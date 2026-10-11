import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, fireEvent, render, renderHook, screen } from "@testing-library/react";
import { afterEach, expect, test, vi } from "vitest";
import { agentPanel, useAgentPanelOpen, type AgentMeta } from "@/lib/agent";
import { api } from "@/lib/api";
import { openCommandMenu } from "@/lib/commandMenu";
import { setMobile } from "@/test/media";
import { CommandMenu } from "./CommandMenu";

const navigate = vi.fn();
vi.mock("@tanstack/react-router", () => ({ useNavigate: () => navigate }));
vi.mock("@/lib/api", async (orig) => ({
  ...(await orig<typeof import("@/lib/api")>()),
  api: { search: vi.fn() },
}));
afterEach(() => {
  navigate.mockReset();
  vi.mocked(api.search).mockReset();
});

const renderMenu = () =>
  render(
    <QueryClientProvider client={new QueryClient()}>
      <CommandMenu />
    </QueryClientProvider>,
  );
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
  renderMenu();
  act(() => openCommandMenu());
  expect(screen.getByRole("combobox").className).toContain("max-md:pr-10");
  expect(screen.getByRole("listbox").className).toContain("max-md:max-h-none");
});

test("the AI item shows only when an agent exists and opens the panel", () => {
  agents = [{ id: "claude", name: "Claude Code", login: "claude" }];
  renderMenu();
  const { result } = renderHook(() => useAgentPanelOpen());
  act(() => openCommandMenu());
  fireEvent.click(screen.getByRole("option", { name: "Ask AI" }));
  expect(result.current).toBe(true);
});

test("no AI item without agents", () => {
  renderMenu();
  act(() => openCommandMenu());
  expect(screen.queryByRole("option", { name: "Ask AI" })).toBeNull();
});

const type = (text: string) => fireEvent.change(screen.getByRole("combobox"), { target: { value: text } });

test("no request below 2 characters", async () => {
  renderMenu();
  act(() => openCommandMenu());
  type("a");
  await new Promise((r) => setTimeout(r, 300));
  expect(api.search).not.toHaveBeenCalled();
});

test("record hits from every table are listed and open the record", async () => {
  vi.mocked(api.search).mockResolvedValue({
    hits: [
      { table: "projects", key: "alpha", label: "Alpha site", column: "id", value: "alpha", rank: 0, total: 1 },
      { table: "tasks", key: "t1", label: null, column: "title", value: "about alpha", rank: 3, total: 1 },
    ],
  });
  renderMenu();
  act(() => openCommandMenu());
  type("alpha");
  await vi.waitFor(() => expect(api.search).toHaveBeenCalledWith("alpha", 5));
  const options = await screen.findAllByRole("option", { name: /alpha|t1/ });
  expect(options.map((o) => o.textContent)).toEqual([
    expect.stringContaining("projects"),
    expect.stringContaining("tasks"),
  ]);
  fireEvent.click(screen.getByRole("option", { name: /t1/ }));
  expect(navigate).toHaveBeenCalledWith({ to: "/t/$table", params: { table: "tasks" }, search: { key: "t1" } });
});

test("see all results opens the search page", async () => {
  vi.mocked(api.search).mockResolvedValue({
    hits: [{ table: "tasks", key: "alpha", label: null, column: "id", value: "alpha", rank: 0, total: 3 }],
  });
  renderMenu();
  act(() => openCommandMenu());
  type("alpha");
  fireEvent.click(await screen.findByRole("option", { name: "See all 3 results" }));
  expect(navigate).toHaveBeenCalledWith({ to: "/search", search: { q: "alpha" } });
});

test("a record shows its label, key, table and the matched column", async () => {
  vi.mocked(api.search).mockResolvedValue({
    hits: [
      { table: "projects", key: "alpha", label: "Alpha site", column: "id", value: "alpha", rank: 0, total: 1 },
      { table: "tasks", key: "t1", label: "Ship", column: "note", value: "about alpha", rank: 3, total: 1 },
    ],
  });
  renderMenu();
  act(() => openCommandMenu());
  type("alpha");
  const first = await screen.findByRole("option", { name: /Alpha site/ });
  expect(first.textContent).toBe("Alpha sitealphaprojects");
  expect(screen.getByRole("option", { name: /Ship/ }).textContent).toBe("Shipt1tasksnote: about alpha");
});

test("nothing found stays hidden while records are listed", async () => {
  vi.mocked(api.search).mockResolvedValue({
    hits: [{ table: "tasks", key: "zz-top", label: null, column: "id", value: "zz-top", rank: 0, total: 1 }],
  });
  renderMenu();
  act(() => openCommandMenu());
  type("zz-top");
  await screen.findByRole("option", { name: /zz-top/ });
  expect(screen.queryByText("Nothing found")).toBeNull();
});

test("cmd+enter opens every result", async () => {
  vi.mocked(api.search).mockResolvedValue({
    hits: [{ table: "tasks", key: "alpha", label: null, column: "id", value: "alpha", rank: 0, total: 1 }],
  });
  renderMenu();
  act(() => openCommandMenu());
  type("alpha");
  await screen.findByRole("option", { name: /alpha/ });
  fireEvent.keyDown(screen.getByRole("combobox"), { key: "Enter", metaKey: true });
  expect(navigate).toHaveBeenCalledWith({ to: "/search", search: { q: "alpha" } });
});

test("the best record is selected when results arrive, so enter opens it", async () => {
  vi.mocked(api.search).mockResolvedValue({
    hits: [
      { table: "tasks", key: "t1", label: null, column: "title", value: "about alpha", rank: 3, total: 1 },
      { table: "projects", key: "alpha", label: null, column: "id", value: "alpha", rank: 0, total: 1 },
    ],
  });
  renderMenu();
  act(() => openCommandMenu());
  type("alpha");
  const best = await screen.findByRole("option", { name: /^alphaprojects/ });
  await vi.waitFor(() => expect(best.getAttribute("aria-selected")).toBe("true"));
});
