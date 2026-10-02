import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { expect, test, vi } from "vitest";
import { api } from "@/lib/api";
import type { TableMeta } from "@/lib/types";
import { RecordDrawer } from "./RecordDrawer";

vi.mock("@tanstack/react-router", () => ({ useNavigate: () => vi.fn() }));
vi.mock("@/lib/providers", () => ({
  useEvents: () => ({ connected: true }),
  useReflect: () => undefined,
  useReflectDispatch: () => vi.fn(),
}));
vi.mock("@/lib/api", async (orig) => ({
  ...(await orig<typeof import("@/lib/api")>()),
  api: { record: vi.fn(), update: vi.fn(), remove: vi.fn(), rows: vi.fn() },
}));

const table: TableMeta = {
  name: "tasks",
  mode: "dir",
  path: "tasks",
  key: "id",
  columns: { id: "TEXT", title: "TEXT", prio: "INTEGER" },
  references: [],
  count: 1,
  inDb: true,
};

test("after a save the form keeps the saved values until the refetch arrives", async () => {
  vi.mocked(api.record)
    .mockResolvedValueOnce({ row: { id: "a", title: "old", prio: null }, file: "tasks/a.yaml", yaml: "" })
    .mockReturnValue(new Promise(() => {}));
  vi.mocked(api.update).mockResolvedValue({ ok: true });
  render(
    <QueryClientProvider client={new QueryClient()}>
      <RecordDrawer table={table} recordKey="a" />
    </QueryClientProvider>,
  );
  const title = (await screen.findByLabelText("title")) as HTMLInputElement;
  fireEvent.change(title, { target: { value: "new" } });
  fireEvent.click(screen.getByRole("button", { name: /Save/ }));
  await waitFor(() => expect(api.update).toHaveBeenCalled());
  await waitFor(() => expect(screen.getByRole("button", { name: /Save/ }).hasAttribute("disabled")).toBe(true));
  expect(screen.getByLabelText("title")).toBe(title);
  expect(title.value).toBe("new");
});

test("an unset INTEGER shows the 0 it was given", async () => {
  vi.mocked(api.record).mockResolvedValue({ row: { id: "a", title: "x", prio: null }, file: "f", yaml: "" });
  render(
    <QueryClientProvider client={new QueryClient()}>
      <RecordDrawer table={table} recordKey="a" />
    </QueryClientProvider>,
  );
  fireEvent.click(await screen.findByLabelText("prio"));
  expect((screen.getByLabelText("prio") as HTMLInputElement).value).toBe("0");
});
