import { act, fireEvent, render, renderHook, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { agentPanel, useAgentPanelOpen, type AgentMeta } from "@/lib/agent";
import { api } from "@/lib/api";
import { enterStatic } from "@/lib/mode";
import type { Snapshot, TableMeta } from "@/lib/types";
import { Sidebar } from "./Sidebar";

let here: { table: string; filter?: unknown[] } | null = null;
vi.mock("@tanstack/react-router", () => ({
  Link: ({
    children,
    params,
    search,
    className,
    activeProps,
  }: {
    children: React.ReactNode;
    params?: { table?: string };
    search?: { filter?: unknown[] };
    className?: string;
    activeProps?: { className?: string };
  }) => (
    <a
      href={`#${params?.table ?? ""}${search?.filter ? `?filter=${JSON.stringify(search.filter)}` : ""}`}
      className={className}
      data-active-style={activeProps?.className ? "yes" : "no"}
    >
      {children}
    </a>
  ),
  useRouterState: ({ select }: { select: (s: unknown) => unknown }) =>
    select({
      matches: here ? [{ routeId: "/t/$table", params: { table: here.table }, search: { filter: here.filter } }] : [],
    }),
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

const table = (name: string, group: string | null, split: TableMeta["split"] = null): TableMeta => ({
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
  split,
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
  here = null;
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
  fireEvent.click(within(crm).getByRole("button", { name: "Items of people" }));
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
  fireEvent.click(await screen.findByRole("button", { name: "Ask AI" }));
  expect(result.current).toBe(true);
  fireEvent.click(screen.getByRole("button", { name: "Ask AI" }));
  expect(result.current).toBe(false);
});

test("no AI button without agents", async () => {
  await renderSidebar();
  await screen.findByText("deals");
  expect(screen.queryByRole("button", { name: "Ask AI" })).toBeNull();
});

test("in the phone menu the AI button closes the menu and keeps the panel open", async () => {
  agents = [{ id: "claude", name: "Claude Code", login: "claude" }];
  const onSearch = vi.fn();
  await renderSidebar({ onSearch });
  const { result } = renderHook(() => useAgentPanelOpen());
  const button = await screen.findByRole("button", { name: "Ask AI" });
  fireEvent.click(button);
  fireEvent.click(button);
  expect(onSearch).toHaveBeenCalledTimes(2);
  expect(result.current).toBe(true);
});

const splitMeta = (name = "notes"): Snapshot["meta"] => ({
  ...meta,
  tables: [
    table(name, null, {
      column: "type",
      json: false,
      items: [
        { value: "idea", count: 2 },
        { value: null, count: 1 },
      ],
    }),
  ],
  views: [],
});

test("split items start folded and the chevron shows them, remembered across mounts", async () => {
  vi.mocked(api.meta).mockResolvedValue(splitMeta());
  const { unmount } = await renderSidebar();
  const toggle = await screen.findByRole("button", { name: "Items of notes" });
  expect(toggle.getAttribute("aria-expanded")).toBe("false");
  expect(screen.queryByText("idea")).toBeNull();
  fireEvent.click(toggle);
  expect(screen.getByText("idea")).toBeTruthy();
  expect(screen.getByText("(none)")).toBeTruthy();
  unmount();
  await renderSidebar();
  expect(await screen.findByText("idea")).toBeTruthy();
});

test("each item links to its filter", async () => {
  vi.mocked(api.meta).mockResolvedValue(splitMeta());
  await renderSidebar();
  fireEvent.click(await screen.findByRole("button", { name: "Items of notes" }));
  expect(screen.getByText("idea").closest("a")?.getAttribute("href")).toBe(
    `#notes?filter=${JSON.stringify([{ col: "type", op: "eq", value: "idea" }])}`,
  );
  expect(screen.getByText("(none)").closest("a")?.getAttribute("href")).toBe(
    `#notes?filter=${JSON.stringify([{ col: "type", op: "null" }])}`,
  );
});

test("an active item opens its table and is the only one highlighted", async () => {
  here = { table: "my notes", filter: [{ col: "type", op: "eq", value: "idea" }] };
  vi.mocked(api.meta).mockResolvedValue(splitMeta("my notes"));
  await renderSidebar();
  const idea = (await screen.findByText("idea")).closest("a")!;
  expect(idea.className).toContain("bg-tomato");
  expect(screen.getByText("(none)").closest("a")!.className).not.toContain("bg-tomato");
  expect(screen.getByText("my notes").closest("a")!.getAttribute("data-active-style")).toBe("no");
  expect(localStorage.getItem("yamlite-expanded-tables")).toBeNull();
});

test("without an active item the table row keeps its active style", async () => {
  here = { table: "notes" };
  vi.mocked(api.meta).mockResolvedValue(splitMeta());
  await renderSidebar();
  expect((await screen.findByText("notes")).closest("a")!.getAttribute("data-active-style")).toBe("yes");
});

test("the chevron folds a table opened by its active item without persisting", async () => {
  here = { table: "my notes", filter: [{ col: "type", op: "eq", value: "idea" }] };
  vi.mocked(api.meta).mockResolvedValue(splitMeta("my notes"));
  await renderSidebar();
  await screen.findByText("idea");
  const toggle = screen.getByRole("button", { name: "Items of my notes" });
  fireEvent.click(toggle);
  expect(screen.queryByText("idea")).toBeNull();
  expect(toggle.getAttribute("aria-expanded")).toBe("false");
  expect(localStorage.getItem("yamlite-expanded-tables")).toBeNull();
  fireEvent.click(toggle);
  expect(screen.getByText("idea")).toBeTruthy();
  expect(toggle.getAttribute("aria-expanded")).toBe("true");
  expect(localStorage.getItem("yamlite-expanded-tables")).toBeNull();
});

test("views start folded behind the same chevron and open while one is shown", async () => {
  const { unmount } = await renderSidebar();
  const toggle = await screen.findByRole("button", { name: "Items of people" });
  expect(screen.queryByText("people__roles")).toBeNull();
  expect(screen.queryByRole("button", { name: "Items of deals" })).toBeNull();
  fireEvent.click(toggle);
  expect(screen.getByText("people__roles")).toBeTruthy();
  unmount();
  localStorage.clear();
  here = { table: "people__roles" };
  await renderSidebar();
  expect(await screen.findByText("people__roles")).toBeTruthy();
});

test("a table folded while its item is shown opens again on return and the chevron keeps working", async () => {
  vi.mocked(api.meta).mockResolvedValue(splitMeta());
  here = { table: "notes", filter: [{ col: "type", op: "eq", value: "idea" }] };
  const { rerender } = await renderSidebar();
  const toggle = await screen.findByRole("button", { name: "Items of notes" });
  fireEvent.click(toggle);
  expect(screen.queryByText("idea")).toBeNull();
  const { Providers } = await import("@/lib/providers");
  here = { table: "notes" };
  rerender(
    <Providers>
      <Sidebar />
    </Providers>,
  );
  fireEvent.click(toggle);
  expect(screen.getByText("idea")).toBeTruthy();
  fireEvent.click(toggle);
  expect(screen.queryByText("idea")).toBeNull();
  here = { table: "notes", filter: [{ col: "type", op: "eq", value: "idea" }] };
  rerender(
    <Providers>
      <Sidebar />
    </Providers>,
  );
  expect(screen.getByText("idea")).toBeTruthy();
  fireEvent.click(toggle);
  expect(screen.queryByText("idea")).toBeNull();
});
