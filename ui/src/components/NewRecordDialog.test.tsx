import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, expect, test, vi } from "vitest";
import { api } from "@/lib/api";
import type { TableMeta } from "@/lib/types";
import { NewRecordDialog } from "./NewRecordDialog";

const navigate = vi.fn();
vi.mock("@tanstack/react-router", () => ({ useNavigate: () => navigate }));
vi.mock("@/lib/api", () => ({ api: { create: vi.fn().mockResolvedValue({}) } }));
vi.mock("@/lib/providers", () => ({
  useEvents: () => ({ connected: true }),
  useReflect: () => undefined,
  useReflectDispatch: () => vi.fn(),
}));

afterEach(cleanup);

const table: TableMeta = {
  name: "tasks",
  mode: "files",
  path: "tasks",
  key: "id",
  columns: { id: "TEXT", title: "TEXT" },
  formats: {},
  values: {},
  required: ["title"],
  min: {},
  max: {},
  references: [],
  count: 0,
  inDb: true,
  group: null,
  split: null,
};

test("a required column shows * and the warn color until it has a value", () => {
  render(
    <QueryClientProvider client={new QueryClient()}>
      <NewRecordDialog table={table} open onOpenChange={() => {}} />
    </QueryClientProvider>,
  );
  const star = screen.getByLabelText("required");
  expect(star.textContent).toBe(" *");
  const label = star.parentElement as HTMLElement;
  expect(label.className).toContain("text-warn");
  fireEvent.click(screen.getByLabelText("title"));
  fireEvent.change(screen.getByLabelText("title"), { target: { value: "x" } });
  expect(label.className).not.toContain("text-warn");
});

const renderDialog = (initial?: Record<string, unknown>) =>
  render(
    <QueryClientProvider client={new QueryClient()}>
      <NewRecordDialog table={table} open onOpenChange={() => {}} initial={initial} />
    </QueryClientProvider>,
  );

test("starting values are filled in and sent", async () => {
  renderDialog({ title: "seeded" });
  expect((screen.getByLabelText("title") as HTMLInputElement).value).toBe("seeded");
  fireEvent.change(screen.getByLabelText("new key"), { target: { value: "k" } });
  fireEvent.click(screen.getByRole("button", { name: "Add" }));
  await waitFor(() => expect(api.create).toHaveBeenCalledWith("tasks", "k", { title: "seeded" }));
});

test("after saving, the filter stays and the new record opens", async () => {
  renderDialog();
  fireEvent.change(screen.getByLabelText("new key"), { target: { value: "k" } });
  fireEvent.click(screen.getByRole("button", { name: "Add" }));
  await waitFor(() => expect(navigate).toHaveBeenCalled());
  const { search } = navigate.mock.calls.at(-1)![0] as { search: (p: object) => object };
  const filter = [{ col: "title", op: "eq", value: "x" }];
  expect(search({ filter })).toEqual({ filter, key: "k" });
});

test("a new starting value replaces the previous one", () => {
  const client = new QueryClient();
  const view = (initial: Record<string, unknown>) => (
    <QueryClientProvider client={client}>
      <NewRecordDialog key={JSON.stringify(initial)} table={table} open onOpenChange={() => {}} initial={initial} />
    </QueryClientProvider>
  );
  const { rerender } = render(view({ title: "a" }));
  rerender(view({ title: "b" }));
  expect((screen.getByLabelText("title") as HTMLInputElement).value).toBe("b");
});

test("saving a map value resets the form without crashing the still-open fields", async () => {
  const json: TableMeta = { ...table, columns: { id: "TEXT", meta: "JSON" }, required: [] };
  render(
    <QueryClientProvider client={new QueryClient()}>
      <NewRecordDialog table={json} open onOpenChange={() => {}} />
    </QueryClientProvider>,
  );
  fireEvent.click(screen.getByLabelText("meta as map"));
  fireEvent.click(screen.getByText("+ key"));
  const input = screen.getByLabelText("new key in meta");
  fireEvent.change(input, { target: { value: "a" } });
  fireEvent.keyDown(input, { key: "Enter" });
  fireEvent.change(screen.getByLabelText("new key"), { target: { value: "k" } });
  fireEvent.click(screen.getByRole("button", { name: "Add" }));
  await waitFor(() => expect(api.create).toHaveBeenCalledWith("tasks", "k", { meta: { a: "" } }));
  await waitFor(() => expect(screen.getByLabelText("meta as map")).toBeTruthy());
});

test("saving a list value resets the form without crashing the still-open fields", async () => {
  const json: TableMeta = { ...table, columns: { id: "TEXT", tags: "JSON" }, required: [] };
  render(
    <QueryClientProvider client={new QueryClient()}>
      <NewRecordDialog table={json} open onOpenChange={() => {}} />
    </QueryClientProvider>,
  );
  fireEvent.click(screen.getByLabelText("tags as list"));
  fireEvent.change(screen.getByLabelText("new key"), { target: { value: "k" } });
  fireEvent.click(screen.getByRole("button", { name: "Add" }));
  await waitFor(() => expect(api.create).toHaveBeenCalledWith("tasks", "k", { tags: [] }));
  await waitFor(() => expect(screen.getByLabelText("tags as list")).toBeTruthy());
});

test("Cancel and Add record stay below the scrolling fields", () => {
  renderDialog();
  const body = document.querySelector('[data-slot="dialog-body"]') as HTMLElement;
  expect(body.contains(screen.getByLabelText("title"))).toBe(true);
  expect(body.contains(screen.getByRole("button", { name: "Cancel" }))).toBe(false);
  expect(screen.getByRole("button", { name: "Cancel" }).closest('[role="dialog"]')).toBeTruthy();
});

const withTags: TableMeta = { ...table, columns: { ...table.columns, tags: "JSON" } };
const renderTags = () =>
  render(
    <QueryClientProvider client={new QueryClient()}>
      <NewRecordDialog table={withTags} open onOpenChange={() => {}} />
    </QueryClientProvider>,
  );

test("a JSON field's chosen type can be changed back to the chooser", () => {
  renderTags();
  expect(screen.queryByRole("button", { name: "Change type of tags" })).toBeNull();
  fireEvent.click(screen.getByLabelText("tags as list"));
  expect(screen.getByLabelText("tags").tagName).toBe("INPUT");
  const confirm = vi.spyOn(window, "confirm");
  fireEvent.click(screen.getByRole("button", { name: "Change type of tags" }));
  expect(confirm).not.toHaveBeenCalled();
  expect(screen.getByLabelText("tags as map")).toBeTruthy();
  expect(screen.queryByRole("button", { name: "Change type of tags" })).toBeNull();
  confirm.mockRestore();
});

test("changing the type of a JSON field with values asks first, and declining keeps them", () => {
  renderTags();
  fireEvent.click(screen.getByLabelText("tags as list"));
  const input = screen.getByLabelText("tags");
  fireEvent.change(input, { target: { value: "a" } });
  fireEvent.keyDown(input, { key: "Enter" });
  const confirm = vi.spyOn(window, "confirm").mockReturnValue(false);
  fireEvent.click(screen.getByRole("button", { name: "Change type of tags" }));
  expect(confirm).toHaveBeenCalledWith("Clear this field and choose another type?");
  expect(screen.getByRole("button", { name: "remove a" })).toBeTruthy();
  confirm.mockReturnValue(true);
  fireEvent.click(screen.getByRole("button", { name: "Change type of tags" }));
  expect(screen.getByLabelText("tags as list")).toBeTruthy();
  confirm.mockRestore();
});
