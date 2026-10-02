import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { expect, test, vi } from "vitest";
import { api } from "@/lib/api";
import type { TableMeta } from "@/lib/types";
import { RecordDrawer } from "./RecordDrawer";

const dispatch = vi.hoisted(() => vi.fn());
const navigate = vi.hoisted(() => vi.fn());
vi.mock("@tanstack/react-router", () => ({ useNavigate: () => navigate }));
vi.mock("@/lib/providers", () => ({
  useEvents: () => ({ connected: true }),
  useReflect: () => undefined,
  useReflectDispatch: () => dispatch,
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

test("write-back tracking starts before the save responds, and a failed save cancels it", async () => {
  dispatch.mockClear();
  vi.mocked(api.record).mockResolvedValue({ row: { id: "a", title: "old", prio: null }, file: "f", yaml: "" });
  let fail: (e: Error) => void = () => {};
  vi.mocked(api.update).mockReturnValue(new Promise((_r, reject) => (fail = reject)));
  render(
    <QueryClientProvider client={new QueryClient()}>
      <RecordDrawer table={table} recordKey="a" />
    </QueryClientProvider>,
  );
  fireEvent.change(await screen.findByLabelText("title"), { target: { value: "new" } });
  fireEvent.click(screen.getByRole("button", { name: /Save/ }));
  // the watcher may write the file before the response, so the entry must already exist
  await waitFor(() => expect(dispatch).toHaveBeenCalledWith(expect.objectContaining({ type: "saved", key: "a" })));
  fail(new Error("boom"));
  await waitFor(() => expect(dispatch).toHaveBeenCalledWith({ type: "cancelled", table: "tasks", key: "a" }));
});

async function openDrawer() {
  navigate.mockClear();
  vi.mocked(api.record).mockResolvedValue({
    row: { id: "a", title: "old", prio: null },
    file: "tasks/a.yaml",
    yaml: "",
  });
  render(
    <QueryClientProvider client={new QueryClient()}>
      <main>
        <div role="row" data-key="b">
          <span>row b</span>
        </div>
        <p>outside</p>
      </main>
      <RecordDrawer table={table} recordKey="a" />
    </QueryClientProvider>,
  );
  return (await screen.findByLabelText("title")) as HTMLInputElement;
}

const closedKey = () => {
  const search = navigate.mock.calls.at(-1)?.[0]?.search as ((p: object) => { key?: string }) | undefined;
  return search?.({ key: "a", sort: "title:asc" });
};

test("Escape closes the drawer", async () => {
  await openDrawer();
  fireEvent.keyDown(document, { key: "Escape" });
  expect(navigate).toHaveBeenCalledTimes(1);
  expect(closedKey()).toEqual({ key: undefined, sort: "title:asc" });
});

test("a click outside closes the drawer; inside it or on another row does not", async () => {
  const title = await openDrawer();
  fireEvent.click(title);
  fireEvent.click(screen.getByText("row b"));
  expect(navigate).not.toHaveBeenCalled();
  fireEvent.click(screen.getByText("outside"));
  expect(navigate).toHaveBeenCalledTimes(1);
  expect(closedKey()).toEqual({ key: undefined, sort: "title:asc" });
});

test("unsaved edits keep the drawer open on Escape or a click outside", async () => {
  const title = await openDrawer();
  fireEvent.change(title, { target: { value: "new" } });
  fireEvent.keyDown(document, { key: "Escape" });
  fireEvent.click(screen.getByText("outside"));
  expect(navigate).not.toHaveBeenCalled();
});
