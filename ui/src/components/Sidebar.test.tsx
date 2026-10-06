import { act, fireEvent, render, renderHook, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { agentPanel, useAgentPanelOpen, type AgentMeta } from "@/lib/agent";
import { api } from "@/lib/api";
import { enterStatic } from "@/lib/mode";
import type { Snapshot, TableMeta } from "@/lib/types";
import { Sidebar } from "./Sidebar";

vi.mock("@tanstack/react-router", () => ({
  Link: ({ children, params }: { children: React.ReactNode; params?: { table?: string } }) => (
    <a href={`#${params?.table ?? ""}`}>{children}</a>
  ),
}));
let agents: AgentMeta[] = [];
vi.mock("@/lib/agent", async (orig) => ({
  ...(await orig<typeof import("@/lib/agent")>()),
  useAgents: () => agents,
}));
vi.mock("@/lib/api", async (orig) => ({
  ...(await orig<typeof import("@/lib/api")>()),
  api: { meta: vi.fn(), conflicts: vi.fn() },
}));

const table = (name: string, group: string | null): TableMeta => ({
  name,
  mode: "files",
  path: name,
  key: "id",
  columns: { id: "TEXT" },
  formats: {},
  values: {},
  required: [],
  min: {},
  max: {},
  references: [],
  count: 0,
  inDb: true,
  group,
});
const meta: Snapshot["meta"] = {
  root: "data",
  db: "db.sqlite",
  configFile: "yamlite.yaml",
  configError: null,
  tables: [table("deals", "CRM"), table("notes", null), table("people", "CRM")],
  views: [
    {
      name: "people__roles",
      table: "people",
      parent: "people",
      depth: 1,
      columns: {},
      identity: [],
      declared: {},
      references: [],
      values: {},
      required: [],
      formats: {},
      min: {},
      max: {},
      count: 0,
      inDb: true,
    },
  ],
  pages: [],
};

beforeEach(() => {
  localStorage.clear();
  enterStatic({ version: 1, generatedAt: "2026-10-05T00:00:00.000Z", meta, schemas: {}, warnings: {} });
  vi.mocked(api.meta).mockResolvedValue(meta);
});
afterEach(() => {
  enterStatic(null);
  agents = [];
  act(() => agentPanel.close());
});

async function renderSidebar(props: { onSearch?: () => void } = {}) {
  const { Providers } = await import("@/lib/providers");
  return render(
    <Providers>
      <Sidebar {...props} />
    </Providers>,
  );
}

test("grouped tables sit under their group, with their views, after the ungrouped ones", async () => {
  await renderSidebar();
  const crm = await screen.findByRole("group", { name: "CRM" });
  expect(
    within(crm)
      .getAllByRole("link")
      .map((a) => a.textContent?.replace(/\d+$/, "")),
  ).toEqual(["deals", "people", "people__roles"]);
  const nav = screen.getAllByRole("navigation")[0]!;
  const links = within(nav)
    .getAllByRole("link")
    .map((a) => a.textContent?.replace(/\d+$/, ""));
  expect(links[0]).toBe("notes");
});

test("a group folds away and stays folded", async () => {
  const { unmount } = await renderSidebar();
  fireEvent.click(await screen.findByRole("button", { name: "CRM" }));
  expect(screen.getByRole("button", { name: "CRM" }).getAttribute("aria-expanded")).toBe("false");
  expect(screen.queryByText("deals")).toBeNull();
  unmount();
  await renderSidebar();
  expect((await screen.findByRole("button", { name: "CRM" })).getAttribute("aria-expanded")).toBe("false");
  expect(screen.getByText("notes")).toBeTruthy();
});

test("without groups there are no group headings", async () => {
  vi.mocked(api.meta).mockResolvedValue({ ...meta, tables: meta.tables.map((t) => ({ ...t, group: null })) });
  await renderSidebar();
  expect(await screen.findByText("deals")).toBeTruthy();
  expect(screen.queryByRole("group")).toBeNull();
});

test("the AI button shows only when an agent exists and toggles the panel", async () => {
  agents = [{ id: "claude", name: "Claude Code", login: "claude" }];
  await renderSidebar();
  const { result } = renderHook(() => useAgentPanelOpen());
  fireEvent.click(await screen.findByRole("button", { name: "AI に依頼" }));
  expect(result.current).toBe(true);
  fireEvent.click(screen.getByRole("button", { name: "AI に依頼" }));
  expect(result.current).toBe(false);
});

test("no AI button without agents", async () => {
  await renderSidebar();
  await screen.findByText("deals");
  expect(screen.queryByRole("button", { name: "AI に依頼" })).toBeNull();
});

test("in the phone menu the AI button closes the menu and keeps the panel open", async () => {
  agents = [{ id: "claude", name: "Claude Code", login: "claude" }];
  const onSearch = vi.fn();
  await renderSidebar({ onSearch });
  const { result } = renderHook(() => useAgentPanelOpen());
  const button = await screen.findByRole("button", { name: "AI に依頼" });
  fireEvent.click(button);
  fireEvent.click(button);
  expect(onSearch).toHaveBeenCalledTimes(2);
  expect(result.current).toBe(true);
});
