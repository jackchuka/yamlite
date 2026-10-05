import { fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { api } from "@/lib/api";
import { enterStatic } from "@/lib/mode";
import type { Snapshot, TableMeta } from "@/lib/types";
import { Sidebar } from "./Sidebar";

vi.mock("@tanstack/react-router", () => ({
  Link: ({ children, params }: { children: React.ReactNode; params?: { table?: string } }) => (
    <a href={`#${params?.table ?? ""}`}>{children}</a>
  ),
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
afterEach(() => enterStatic(null));

async function renderSidebar() {
  const { Providers } = await import("@/lib/providers");
  return render(
    <Providers>
      <Sidebar />
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
