import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, expect, test, vi } from "vitest";
import { api } from "@/lib/api";
import type { TableMeta } from "@/lib/types";
import { GroupButton } from "./GroupButton";

const table = (name: string, group: string | null): TableMeta => ({
  name,
  mode: "files",
  path: name,
  key: "id",
  columns: {},
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
const tables = [table("tasks", null), table("people", "CRM"), table("deals", "Sales")];

vi.mock("@/lib/providers", () => ({
  useEvents: () => ({ connected: true }),
  useMeta: () => ({ data: { tables } }),
}));
vi.mock("@/lib/api", async (orig) => ({
  ...(await orig<typeof import("@/lib/api")>()),
  api: { setGroup: vi.fn() },
}));

beforeEach(() => vi.mocked(api.setGroup).mockReset().mockResolvedValue({ name: "x", group: null }));

function show(t: TableMeta) {
  render(
    <QueryClientProvider client={new QueryClient()}>
      <GroupButton table={t} />
    </QueryClientProvider>,
  );
  fireEvent.click(screen.getByRole("button", { name: /group/i }));
}

test("a group is typed or picked from the existing ones and saved", async () => {
  show(tables[0]!);
  const input = await screen.findByRole("combobox", { name: "group name" });
  expect([...document.querySelectorAll("datalist option")].map((o) => o.getAttribute("value"))).toEqual([
    "CRM",
    "Sales",
  ]);
  fireEvent.change(input, { target: { value: " CRM " } });
  fireEvent.click(screen.getByRole("button", { name: "保存" }));
  await waitFor(() => expect(api.setGroup).toHaveBeenCalledWith("tasks", "CRM"));
});

test("a table's group is shown and can be removed", async () => {
  show(tables[1]!);
  expect(screen.getByRole("button", { name: /group/i }).textContent).toContain("CRM");
  expect((await screen.findByRole("combobox", { name: "group name" })).getAttribute("value")).toBe("CRM");
  fireEvent.click(screen.getByRole("button", { name: "グループなし" }));
  await waitFor(() => expect(api.setGroup).toHaveBeenCalledWith("people", null));
});

test("a refused change is shown", async () => {
  vi.mocked(api.setGroup).mockRejectedValueOnce(new Error("invalid yamlite.yaml"));
  show(tables[0]!);
  fireEvent.change(await screen.findByRole("combobox", { name: "group name" }), { target: { value: "X" } });
  fireEvent.click(screen.getByRole("button", { name: "保存" }));
  expect(await screen.findByText("invalid yamlite.yaml")).toBeTruthy();
});
