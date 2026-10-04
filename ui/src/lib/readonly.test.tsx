import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { RecordDrawer } from "@/components/RecordDrawer";
import { Sidebar } from "@/components/Sidebar";
import { StatusBar } from "@/components/StatusBar";
import { api } from "./api";
import { enterStatic } from "./mode";
import type { Snapshot, TableMeta } from "./types";

vi.mock("@tanstack/react-router", () => ({
  useNavigate: () => vi.fn(),
  Link: ({ children, to }: { children: React.ReactNode; to: string }) => <a href={to}>{children}</a>,
}));
vi.mock("./api", async (orig) => ({
  ...(await orig<typeof import("./api")>()),
  api: { meta: vi.fn(), record: vi.fn(), conflicts: vi.fn(), rows: vi.fn() },
}));

const table: TableMeta = {
  name: "tasks",
  mode: "files",
  path: "tasks",
  key: "id",
  columns: { id: "TEXT", title: "TEXT" },
  formats: {},
  references: [],
  count: 1,
  inDb: true,
};
const snapshot: Snapshot = {
  version: 1,
  generatedAt: "2026-10-02T00:00:00.000Z",
  meta: {
    root: "data",
    db: "data/db.sqlite",
    configFile: "yamlite.yaml",
    configError: null,
    tables: [table],
    views: [],
    pages: [],
  },
  schemas: {},
  warnings: { tasks: ["title: something"] },
};

beforeEach(() => {
  enterStatic(snapshot);
  vi.mocked(api.meta).mockResolvedValue(snapshot.meta);
  vi.mocked(api.conflicts).mockResolvedValue({ conflicts: [] });
});
afterEach(() => enterStatic(null));

async function withProviders(ui: React.ReactNode) {
  const { Providers } = await import("./providers");
  return render(<Providers>{ui}</Providers>);
}

test("the sidebar has no New table or Sync, and keeps warning marks", async () => {
  await withProviders(<Sidebar />);
  expect(await screen.findByText("tasks")).toBeTruthy();
  expect(screen.queryByText(/New table/)).toBeNull();
  expect(screen.queryByText("Sync")).toBeNull();
  expect(screen.getByRole("img", { name: "1 warnings" })).toBeTruthy();
});

test("the status bar shows the snapshot instead of a watcher", async () => {
  await withProviders(<StatusBar />);
  expect(await screen.findByText(/Read-only snapshot · 2026-10-02/)).toBeTruthy();
  expect(screen.queryByText(/watching|disconnected|last sync/)).toBeNull();
  expect(api.conflicts).not.toHaveBeenCalled();
});

test("the record drawer is view-only and shows a YAML that failed to load as an error", async () => {
  vi.mocked(api.record).mockResolvedValue({
    row: { id: "a", title: "A" },
    file: "",
    yaml: null,
    yamlError: "data/yaml/tasks.json: 404",
  });
  await withProviders(<RecordDrawer table={table} recordKey="a" />);
  const title = (await screen.findByLabelText("title")) as HTMLInputElement;
  expect(title.closest("fieldset")?.disabled).toBe(true);
  expect(screen.queryByRole("button", { name: /Save/ })).toBeNull();
  expect(screen.queryByRole("button", { name: "delete record" })).toBeNull();
  expect(screen.queryByText("接続が切れています")).toBeNull();
  fireEvent.mouseDown(screen.getByRole("tab", { name: "File" }));
  await waitFor(() => expect(screen.getByText("data/yaml/tasks.json: 404")).toBeTruthy());
});
