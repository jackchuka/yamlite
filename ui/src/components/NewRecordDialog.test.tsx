import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, test, vi } from "vitest";
import type { TableMeta } from "@/lib/types";
import { NewRecordDialog } from "./NewRecordDialog";

vi.mock("@tanstack/react-router", () => ({ useNavigate: () => vi.fn() }));
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
