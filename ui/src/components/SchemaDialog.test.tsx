import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen } from "@testing-library/react";
import { expect, test, vi } from "vitest";
import { api } from "@/lib/api";
import { setReadOnly } from "@/lib/mode";
import type { Meta, TableSchema, ViewMeta } from "@/lib/types";
import { SchemaDialog } from "./SchemaDialog";

vi.mock("@/lib/api", async (orig) => ({
  ...(await orig<typeof import("@/lib/api")>()),
  api: { schema: vi.fn(), meta: vi.fn(), previewRules: vi.fn() },
}));

test("references show their problems and indexes show whether they exist", async () => {
  vi.mocked(api.schema).mockResolvedValue({
    base: "",
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
    formats: {},
    min: {},
    max: {},
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
  expect(screen.getAllByText("Created")).toHaveLength(1);
  expect(screen.getByText("Not created")).toBeTruthy();
  expect(screen.getByText("by_hand")).toBeTruthy();
  expect(screen.getByText("tasks/**/*.{yaml,yml}")).toBeTruthy();
});

test("a table's expanded views link to them and show their problems", async () => {
  vi.mocked(api.schema).mockResolvedValue({
    base: "",
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
    formats: {},
    min: {},
    max: {},
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
          path: ["milestones"],
          columns: { projects_id: "TEXT", idx: "INTEGER", title: "TEXT", points: "INTEGER" },
          identity: ["projects_id", "idx"],
          declared: { title: "TEXT" },
          references: [],
          values: { title: ["Design", "Launch"] },
          required: ["title"],
          formats: {},
          min: {},
          max: {},
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
  expect(label("title")).toBe("declared · required");
  expect(label("points")).toBe("inferred");
  expect(screen.getByText("Design, Launch")).toBeTruthy();
  expect(api.schema).not.toHaveBeenCalled();
});

test("a column's allowed values are listed", async () => {
  vi.mocked(api.schema).mockResolvedValue({
    base: "",
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
    formats: {},
    min: {},
    max: {},
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
  expect(screen.getByText("status").closest("tr")?.children[2]?.textContent).toBe("declared · required");
});

test("columns show their format and bounds", async () => {
  vi.mocked(api.schema).mockResolvedValue({
    base: "",
    name: "tasks",
    mode: "files",
    path: "tasks",
    files: "tasks/**/*.{yaml,yml}",
    key: "id",
    inDb: true,
    columns: { id: "TEXT", priority: "INTEGER", due: "TEXT" },
    declared: { priority: "INTEGER", due: "TEXT" },
    references: [],
    values: {},
    required: [],
    formats: { due: "date" },
    min: { priority: 1, due: "2026-01-01" },
    max: { priority: 5 },
    indexes: [],
    otherIndexes: [],
    views: [],
  });
  render(
    <QueryClientProvider client={new QueryClient()}>
      <SchemaDialog table="tasks" open onOpenChange={() => {}} />
    </QueryClientProvider>,
  );
  const priority = (await screen.findByText("priority")).closest("tr") as HTMLElement;
  expect(priority.textContent).toContain("1 – 5");
  const due = screen.getByText("due").closest("tr") as HTMLElement;
  expect(due.textContent).toContain("date");
  expect(due.textContent).toContain("≥ 2026-01-01");
});

const tasksSchema: TableSchema = {
  base: "h1",
  name: "tasks",
  mode: "files",
  path: "tasks",
  key: "id",
  inDb: true,
  columns: { id: "TEXT", status: "TEXT" },
  declared: { status: "TEXT" },
  references: [],
  values: { status: ["todo", "done"] },
  required: [],
  formats: {},
  min: {},
  max: {},
  indexes: [],
  otherIndexes: [],
  views: [],
};
const tasksMeta = {
  configError: null,
  tables: [
    {
      name: "tasks",
      key: "id",
      required: [],
      values: { status: ["todo", "done"] },
      formats: {},
      min: {},
      max: {},
      references: [],
    },
  ],
  views: [],
} as unknown as Meta;

test("Edit rules swaps the columns for the rule editor", async () => {
  vi.mocked(api.schema).mockResolvedValue(tasksSchema);
  vi.mocked(api.meta).mockResolvedValue(tasksMeta);
  vi.mocked(api.previewRules).mockResolvedValue({ added: [], removed: [], changed: false });
  render(
    <QueryClientProvider client={new QueryClient()}>
      <SchemaDialog table="tasks" open onOpenChange={() => {}} />
    </QueryClientProvider>,
  );
  fireEvent.click(await screen.findByRole("button", { name: "Edit rules" }));
  expect(screen.getByRole("button", { name: /status/ }).textContent).toContain("values 2");
  expect(screen.queryByText("todo, done")).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
  expect(screen.getByText("todo, done")).toBeTruthy();
});

test("read-only hides Edit rules", async () => {
  vi.mocked(api.schema).mockResolvedValue(tasksSchema);
  vi.mocked(api.meta).mockResolvedValue(tasksMeta);
  setReadOnly(true);
  try {
    render(
      <QueryClientProvider client={new QueryClient()}>
        <SchemaDialog table="tasks" open onOpenChange={() => {}} />
      </QueryClientProvider>,
    );
    expect(await screen.findByText("todo, done")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Edit rules" })).toBeNull();
  } finally {
    setReadOnly(false);
  }
});

test("Edit rules makes the indexes and expanded views editable", async () => {
  vi.mocked(api.schema).mockResolvedValue({
    ...tasksSchema,
    columns: { id: "TEXT", status: "TEXT", steps: "JSON" },
    indexes: [{ name: "yamlite_tasks_1", definition: "(status)", columns: ["status"], unique: false, inDb: true }],
  });
  vi.mocked(api.meta).mockResolvedValue(tasksMeta);
  vi.mocked(api.previewRules).mockResolvedValue({ added: [], removed: [], changed: false });
  render(
    <QueryClientProvider client={new QueryClient()}>
      <SchemaDialog table="tasks" open onOpenChange={() => {}} />
    </QueryClientProvider>,
  );
  expect(await screen.findByText("(status)")).toBeTruthy();
  expect(screen.queryByRole("button", { name: "Remove (status)" })).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: "Edit rules" }));
  expect(screen.getAllByText("Indexes")).toHaveLength(1);
  expect(screen.getAllByText("Expanded views")).toHaveLength(1);
  expect(screen.getByRole("button", { name: "Remove (status)" })).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: "+ Add view" }));
  expect(screen.getByLabelText("JSON column")).toBeTruthy();
});

test("editing marks the header and pins Save below the scrolling body", async () => {
  vi.mocked(api.schema).mockResolvedValue({ ...tasksSchema, files: "tasks/*.yaml" });
  vi.mocked(api.meta).mockResolvedValue(tasksMeta);
  vi.mocked(api.previewRules).mockResolvedValue({ added: [], removed: [], changed: false });
  render(
    <QueryClientProvider client={new QueryClient()}>
      <SchemaDialog table="tasks" path="tasks/*.yaml" open onOpenChange={() => {}} />
    </QueryClientProvider>,
  );
  expect(screen.queryByText("Editing")).toBeNull();
  fireEvent.click(await screen.findByRole("button", { name: "Edit rules" }));
  expect(screen.getByText("Editing")).toBeTruthy();
  expect(screen.getByText("Changes are checked against your data before they are saved to yamlite.yaml.")).toBeTruthy();
  expect(screen.queryByText(/To change it, edit yamlite.yaml/)).toBeNull();
  const save = screen.getByRole("button", { name: "Save to yamlite.yaml" });
  expect(save.closest('[data-slot="dialog-body"]')).toBeNull();
  expect(save.closest('[role="dialog"]')).toBeTruthy();
  expect(screen.getAllByText("tasks/*.yaml")).toHaveLength(1);
});

test("a section heading looks the same in read and edit mode", async () => {
  vi.mocked(api.schema).mockResolvedValue(tasksSchema);
  vi.mocked(api.meta).mockResolvedValue(tasksMeta);
  vi.mocked(api.previewRules).mockResolvedValue({ added: [], removed: [], changed: false });
  render(
    <QueryClientProvider client={new QueryClient()}>
      <SchemaDialog table="tasks" open onOpenChange={() => {}} />
    </QueryClientProvider>,
  );
  const read = (await screen.findByText("Indexes")).className;
  const columns = screen.getByText("Columns").className;
  fireEvent.click(screen.getByRole("button", { name: "Edit rules" }));
  expect(screen.getByText("Indexes").className).toBe(read);
  expect(screen.getByText("Expanded views").className).toBe(read);
  expect(screen.getByText("Columns").className).toBe(columns);
  expect(read).toBe(columns);
});

const viewMeta = (name: string, path: string[], columns: Record<string, string>) => ({
  name,
  table: "tasks",
  parent: "tasks",
  depth: path.length,
  path,
  columns,
  identity: ["tasks_id", "idx"],
  declared: {},
  references: [],
  values: {},
  required: [],
  formats: {},
  min: {},
  max: {},
  count: 0,
  inDb: true,
});
const nestedMeta = {
  ...tasksMeta,
  views: [
    viewMeta("tasks__steps", ["steps"], { tasks_id: "TEXT", idx: "INTEGER", note: "TEXT", subs: "JSON" }),
    viewMeta("tasks__steps__subs", ["steps", "subs"], { tasks_id: "TEXT", idx: "INTEGER", done: "BOOLEAN" }),
  ],
} as unknown as Meta;

const openNested = async () => {
  vi.mocked(api.schema).mockResolvedValue({ ...tasksSchema, columns: { id: "TEXT", status: "TEXT", steps: "JSON" } });
  vi.mocked(api.meta).mockResolvedValue(nestedMeta);
  vi.mocked(api.previewRules).mockResolvedValue({ added: [], removed: [], changed: false });
  render(
    <QueryClientProvider client={new QueryClient()}>
      <SchemaDialog table="tasks" open onOpenChange={() => {}} />
    </QueryClientProvider>,
  );
  fireEvent.click(await screen.findByRole("button", { name: "Edit rules" }));
};

test("each section is a card in read and edit mode, with its actions in the header", async () => {
  vi.mocked(api.schema).mockResolvedValue({ ...tasksSchema, columns: { id: "TEXT", status: "TEXT", steps: "JSON" } });
  vi.mocked(api.meta).mockResolvedValue(tasksMeta);
  vi.mocked(api.previewRules).mockResolvedValue({ added: [], removed: [], changed: false });
  render(
    <QueryClientProvider client={new QueryClient()}>
      <SchemaDialog table="tasks" open onOpenChange={() => {}} />
    </QueryClientProvider>,
  );
  const card = (title: string) => screen.getByRole("heading", { name: title }).closest('[data-slot="section-card"]');
  await screen.findByText("Indexes");
  for (const title of ["Table", "Columns", "References", "Indexes", "Expanded views"]) expect(card(title)).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: "Edit rules" }));
  for (const title of ["Table", "Columns", "Indexes", "Expanded views"]) expect(card(title)).toBeTruthy();
  const header = (title: string) => card(title)?.querySelector("header");
  expect(header("Indexes")?.contains(screen.getByRole("button", { name: "+ Add index" }))).toBe(true);
  expect(header("Expanded views")?.contains(screen.getByRole("button", { name: "+ Add view" }))).toBe(true);
});

test("a view's breadcrumb sits in the Columns card's header", async () => {
  await openNested();
  fireEvent.click(screen.getByRole("button", { name: "tasks__steps ▸" }));
  const crumbs = screen.getByRole("navigation", { name: "Breadcrumb" });
  expect(crumbs.closest("header")?.contains(screen.getByRole("heading", { name: "Columns" }))).toBe(true);
});

test("a view opened from the table's editor leads back to the table", async () => {
  await openNested();
  expect(screen.queryByRole("button", { name: "Back to tasks" })).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: "tasks__steps ▸" }));
  expect(screen.getByRole("button", { name: /^note/ })).toBeTruthy();
  const crumbs = screen.getByRole("navigation", { name: "Breadcrumb" });
  expect(crumbs.textContent).toBe("tasks›steps");
  fireEvent.click(screen.getByRole("button", { name: "Back to tasks" }));
  expect(screen.getByRole("button", { name: /^status/ })).toBeTruthy();
  expect(screen.queryByRole("button", { name: /^note/ })).toBeNull();
});

test("leaving a view with a changed draft asks first, and declining stays", async () => {
  await openNested();
  fireEvent.click(screen.getByRole("button", { name: "tasks__steps ▸" }));
  fireEvent.click(screen.getByRole("button", { name: /^note/ }));
  fireEvent.click(screen.getByLabelText("Required"));
  const confirm = vi.spyOn(window, "confirm").mockReturnValue(false);
  fireEvent.click(screen.getByRole("button", { name: "Back to tasks" }));
  expect(confirm).toHaveBeenCalledWith("Discard your draft and load the latest rules?");
  expect((screen.getByLabelText("Required") as HTMLInputElement).checked).toBe(true);
  confirm.mockReturnValue(true);
  fireEvent.click(screen.getByRole("button", { name: "Back to tasks" }));
  expect(screen.getByRole("button", { name: /^status/ })).toBeTruthy();
  confirm.mockRestore();
});

test("a nested view shows every ancestor and goes back to its parent view", async () => {
  await openNested();
  fireEvent.click(screen.getByRole("button", { name: "tasks__steps__subs ▸" }));
  expect(screen.getByRole("navigation", { name: "Breadcrumb" }).textContent).toBe("tasks›steps›subs");
  expect(screen.getByRole("button", { name: "Back to tasks" })).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: "Back to steps" }));
  expect(screen.getByRole("button", { name: /^note/ })).toBeTruthy();
  expect(screen.getByRole("navigation", { name: "Breadcrumb" }).textContent).toBe("tasks›steps");
});

test("a view's own schema dialog can go back to its table's editor", async () => {
  vi.mocked(api.schema).mockResolvedValue({ ...tasksSchema, columns: { id: "TEXT", status: "TEXT", steps: "JSON" } });
  vi.mocked(api.meta).mockResolvedValue(nestedMeta);
  vi.mocked(api.previewRules).mockResolvedValue({ added: [], removed: [], changed: false });
  const view = (nestedMeta.views as ViewMeta[])[0] as ViewMeta;
  render(
    <QueryClientProvider client={new QueryClient()}>
      <SchemaDialog table="tasks__steps" view={view} open onOpenChange={() => {}} />
    </QueryClientProvider>,
  );
  fireEvent.click(await screen.findByRole("button", { name: "Edit rules" }));
  fireEvent.click(await screen.findByRole("button", { name: "Back to tasks" }));
  expect(await screen.findByRole("button", { name: /^status/ })).toBeTruthy();
  expect(screen.getByText("Table")).toBeTruthy();
  expect(screen.queryByText("View")).toBeNull();
});
