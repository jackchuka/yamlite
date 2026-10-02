import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen } from "@testing-library/react";
import { expect, test, vi } from "vitest";
import { api } from "@/lib/api";
import { SchemaDialog } from "./SchemaDialog";

vi.mock("@/lib/api", async (orig) => ({
  ...(await orig<typeof import("@/lib/api")>()),
  api: { schema: vi.fn() },
}));

test("references show their problems and indexes show whether they exist", async () => {
  vi.mocked(api.schema).mockResolvedValue({
    name: "tasks",
    mode: "dir",
    path: "tasks",
    key: "id",
    inDb: true,
    columns: { id: "TEXT", title: "TEXT", project: "TEXT" },
    declared: { title: "TEXT" },
    references: [
      { column: "project", table: "projects", target: "id", problems: ['project "blog" not found in projects.id (b)'] },
    ],
    indexes: [
      { name: "yamlite_tasks_1", definition: "(project)", columns: ["project"], unique: false, inDb: true },
      { name: "yamlite_tasks_2", definition: "(nope)", columns: ["nope"], unique: false, inDb: false },
    ],
    otherIndexes: ["by_hand"],
  });
  render(
    <QueryClientProvider client={new QueryClient()}>
      <SchemaDialog table="tasks" open onOpenChange={() => {}} />
    </QueryClientProvider>,
  );
  expect(await screen.findByText("projects.id")).toBeTruthy();
  expect(screen.getByText('project "blog" not found in projects.id (b)')).toBeTruthy();
  expect(screen.getByText("(project)")).toBeTruthy();
  expect(screen.getAllByText("作成済み")).toHaveLength(1);
  expect(screen.getByText("未作成")).toBeTruthy();
  expect(screen.getByText("by_hand")).toBeTruthy();
});
