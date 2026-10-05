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
    mode: "files",
    path: "tasks",
    files: "tasks/**/*.{yaml,yml}",
    key: "id",
    inDb: true,
    columns: { id: "TEXT", title: "TEXT", project: "TEXT" },
    declared: { title: "TEXT" },
    references: [
      { column: "project", table: "projects", target: "id", problems: ['project "blog" not found in projects.id (b)'] },
    ],
    values: {},
    required: [],
    indexes: [
      { name: "yamlite_tasks_1", definition: "(project)", columns: ["project"], unique: false, inDb: true },
      { name: "yamlite_tasks_2", definition: "(nope)", columns: ["nope"], unique: false, inDb: false },
    ],
    otherIndexes: ["by_hand"],
    views: [],
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
  expect(screen.getByText("tasks/**/*.{yaml,yml}")).toBeTruthy();
});

test("a table's expanded views link to them and show their problems", async () => {
  vi.mocked(api.schema).mockResolvedValue({
    name: "projects",
    mode: "files",
    path: "projects",
    key: "id",
    inDb: true,
    columns: { id: "TEXT", milestones: "JSON" },
    declared: {},
    references: [],
    values: {},
    required: [],
    indexes: [],
    otherIndexes: [],
    views: [
      {
        name: "projects__milestones",
        parent: "projects",
        depth: 1,
        columns: { projects_id: "TEXT", idx: "INTEGER", owner: "TEXT" },
        identity: ["projects_id", "idx"],
        inDb: true,
        problems: ['projects__milestones: owner "carol" not found in people.id (website/1)'],
      },
      {
        name: "projects__tags",
        parent: "projects",
        depth: 1,
        columns: {},
        identity: [],
        inDb: false,
        problems: ['view projects__tags not created: no JSON column "tags"'],
      },
    ],
  });
  render(
    <QueryClientProvider client={new QueryClient()}>
      <SchemaDialog table="projects" open onOpenChange={() => {}} />
    </QueryClientProvider>,
  );
  const link = await screen.findByRole("link", { name: "projects__milestones" });
  expect(link.getAttribute("href")).toBe("#/t/projects__milestones");
  expect(screen.getByText('projects__milestones: owner "carol" not found in people.id (website/1)')).toBeTruthy();
  expect(screen.getByText('view projects__tags not created: no JSON column "tags"')).toBeTruthy();
});

test("a view's schema comes from its meta, without a request", () => {
  vi.mocked(api.schema).mockClear();
  render(
    <QueryClientProvider client={new QueryClient()}>
      <SchemaDialog
        table="projects__milestones"
        view={{
          name: "projects__milestones",
          table: "projects",
          parent: "projects",
          depth: 1,
          columns: { projects_id: "TEXT", idx: "INTEGER", title: "TEXT", points: "INTEGER" },
          identity: ["projects_id", "idx"],
          declared: { title: "TEXT" },
          references: [],
          values: { title: ["Design", "Launch"] },
          required: ["title"],
          count: 2,
          inDb: true,
        }}
        open
        onOpenChange={() => {}}
      />
    </QueryClientProvider>,
  );
  expect(screen.getByText("projects_id, idx")).toBeTruthy();
  const label = (column: string) => screen.getByText(column).closest("tr")?.children[2]?.textContent;
  expect(label("idx")).toBe("identity");
  expect(label("title")).toBe("宣言済み · required");
  expect(label("points")).toBe("推論");
  expect(screen.getByText("Design, Launch")).toBeTruthy();
  expect(api.schema).not.toHaveBeenCalled();
});

test("a column's allowed values are listed", async () => {
  vi.mocked(api.schema).mockResolvedValue({
    name: "tasks",
    mode: "files",
    path: "tasks",
    key: "id",
    inDb: true,
    columns: { id: "TEXT", status: "TEXT" },
    declared: { status: "TEXT" },
    references: [],
    values: { status: ["todo", "done"] },
    required: ["status"],
    indexes: [],
    otherIndexes: [],
    views: [],
  });
  render(
    <QueryClientProvider client={new QueryClient()}>
      <SchemaDialog table="tasks" open onOpenChange={() => {}} />
    </QueryClientProvider>,
  );
  expect(await screen.findByText("todo, done")).toBeTruthy();
  expect(screen.getByText("status").closest("tr")?.children[2]?.textContent).toBe("宣言済み · required");
});
