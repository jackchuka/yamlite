import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, test, vi } from "vitest";
import { api } from "@/lib/api";
import { enterStatic } from "@/lib/mode";
import type { ServeEvent, Snapshot, SqlResult } from "@/lib/types";
import { setMobile } from "@/test/media";
import { SqlConsole } from "./SqlConsole";

let emit: (e: ServeEvent) => void = () => {};
vi.mock("@/lib/providers", () => ({
  useMeta: () => ({
    data: { tables: [{ name: "tasks", mode: "files", path: "tasks", key: "id", columns: { id: "TEXT" } }] },
  }),
  useEventStore: () => ({
    listen: (fn: (e: ServeEvent) => void) => {
      emit = fn;
      return () => {
        emit = () => {};
      };
    },
  }),
  useEvents: () => ({ connected: true }),
}));
vi.mock("@/lib/api", async (orig) => ({
  ...(await orig<typeof import("@/lib/api")>()),
  api: { sql: vi.fn() },
}));

test("a file changed before the response arrives is still listed", async () => {
  let resolve: (r: SqlResult) => void = () => {};
  vi.mocked(api.sql).mockReturnValue(new Promise((r) => (resolve = r)));
  render(
    <QueryClientProvider client={new QueryClient()}>
      <SqlConsole />
    </QueryClientProvider>,
  );
  fireEvent.click(screen.getByRole("button", { name: /Run/ }));
  await vi.waitFor(() => expect(api.sql).toHaveBeenCalled());
  act(() =>
    emit({
      type: "sync",
      at: "",
      table: "tasks",
      ok: true,
      changes: [{ key: "a", op: "toFile" }],
      warnings: [],
      schema: [],
    }),
  );
  await act(async () => resolve({ changes: 1, ms: 1 }));
  expect(await screen.findByText("tasks/a.yaml")).toBeTruthy();
  expect(screen.getByText(/1 row changed/)).toBeTruthy();
});

afterEach(() => enterStatic(null));

async function runUnmanagedWrite() {
  vi.mocked(api.sql).mockResolvedValue({ changes: 1, ms: 1, unmanaged: "x" });
  render(
    <QueryClientProvider client={new QueryClient()}>
      <SqlConsole />
    </QueryClientProvider>,
  );
  fireEvent.click(screen.getByRole("button", { name: /Run/ }));
  await screen.findByText(/1 row changed/);
}

test("the adopt-table banner is offered when the server can write", async () => {
  await runUnmanagedWrite();
  expect(screen.getByRole("button", { name: "Add to yamlite.yaml" })).toBeTruthy();
});

test("the adopt-table banner is hidden in a static export", async () => {
  enterStatic({} as Snapshot);
  await runUnmanagedWrite();
  expect(screen.queryByRole("button", { name: "Add to yamlite.yaml" })).toBeNull();
  expect(screen.queryByText(/not synced/)).toBeNull();
});

test("on a phone, one Run button sits under the editor without the shortcut hint", () => {
  act(() => setMobile(true));
  render(
    <QueryClientProvider client={new QueryClient()}>
      <SqlConsole />
    </QueryClientProvider>,
  );
  const run = screen.getByRole("button", { name: /Run/ });
  expect(run.textContent).not.toContain("⌘");
});
