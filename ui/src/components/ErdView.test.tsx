import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeAll, beforeEach, expect, test, vi } from "vitest";
import { layoutErd } from "@/lib/erdLayout";
import type { Meta } from "@/lib/types";
import { mockReactFlow } from "@/test/reactflow";
import { buildErd } from "@/lib/erd";
import { ErdDiagram, toEdges } from "./ErdView";

const navigate = vi.fn();
vi.mock("@tanstack/react-router", () => ({
  useNavigate: () => navigate,
  Link: ({ children }: { children: React.ReactNode }) => <a href="#">{children}</a>,
}));
vi.mock("@/lib/erdLayout", async (orig) => {
  const real = await orig<typeof import("@/lib/erdLayout")>();
  return { ...real, layoutErd: vi.fn(real.layoutErd) };
});

beforeAll(mockReactFlow);
beforeEach(() => {
  navigate.mockClear();
  vi.mocked(layoutErd).mockClear();
  document.documentElement.dataset.theme = "light";
});

const meta = (taskCount = 3): Meta => ({
  root: "data",
  db: "db.sqlite",
  configFile: "yamlite.yaml",
  configError: null,
  tables: [
    {
      name: "tasks",
      mode: "files",
      path: "tasks",
      key: "id",
      columns: { id: "TEXT", project: "TEXT" },
      formats: {},
      references: [{ column: "project", table: "projects" }],
      count: taskCount,
      inDb: true,
    },
    {
      name: "projects",
      mode: "files",
      path: "projects",
      key: "id",
      columns: { id: "TEXT" },
      formats: {},
      references: [],
      count: 2,
      inDb: true,
    },
    {
      name: "tags",
      mode: "list",
      path: "tags.yaml",
      key: "name",
      columns: { name: "TEXT" },
      formats: {},
      references: [],
      count: 5,
      inDb: true,
    },
  ],
  views: [
    {
      name: "tasks__subtasks",
      table: "tasks",
      parent: "tasks",
      depth: 1,
      columns: { tasks_id: "TEXT", title: "TEXT" },
      identity: ["tasks_id"],
      declared: {},
      references: [],
      count: 4,
      inDb: true,
    },
  ],
  pages: [],
});

const diagram = (m: Meta) => (
  <div style={{ width: 800, height: 600 }}>
    <ErdDiagram meta={m} schemas={new Map()} warnings={{}} />
  </div>
);

test("clicking a table lights it and its neighbours and dims the rest; clicking the pane clears it", async () => {
  render(diagram(meta()));
  fireEvent.click(await screen.findByTestId("erd-node-projects"));
  expect(screen.getByTestId("erd-node-projects").dataset.selected).toBe("true");
  expect(screen.getByTestId("erd-node-tasks").dataset.dimmed).toBeUndefined();
  expect(screen.getByTestId("erd-node-tags").dataset.dimmed).toBe("true");
  expect(screen.getByTestId("erd-node-tasks__subtasks").dataset.dimmed).toBe("true");
  fireEvent.click(document.querySelector(".react-flow__pane") as Element);
  expect(screen.getByTestId("erd-node-tags").dataset.dimmed).toBeUndefined();
});

test("double-clicking a table opens it", async () => {
  render(diagram(meta()));
  await screen.findByTestId("erd-node-tags");
  fireEvent.doubleClick(screen.getByTestId("rf__node-tags"));
  expect(navigate).toHaveBeenCalledWith({ to: "/t/$table", params: { table: "tags" } });
});

test("the views switch hides the views", async () => {
  render(diagram(meta()));
  await screen.findByTestId("erd-node-tasks__subtasks");
  fireEvent.click(screen.getByRole("switch", { name: "ビューを表示" }));
  await waitFor(() => expect(screen.queryByTestId("erd-node-tasks__subtasks")).toBeNull());
  expect(screen.getByTestId("erd-node-tasks")).toBeTruthy();
});

test("a change in the data alone updates the nodes without laying them out again", async () => {
  const { rerender } = render(diagram(meta(3)));
  await screen.findByTestId("erd-node-tasks");
  const laidOut = vi.mocked(layoutErd).mock.calls.length;
  rerender(diagram(meta(9)));
  await waitFor(() => expect(screen.getByTestId("erd-node-tasks").textContent).toContain("9"));
  expect(vi.mocked(layoutErd).mock.calls.length).toBe(laidOut);
  fireEvent.click(screen.getByRole("button", { name: /再レイアウト/ }));
  expect(vi.mocked(layoutErd).mock.calls.length).toBe(laidOut + 1);
});

test("the diagram follows the page theme", async () => {
  render(diagram(meta()));
  const flow = await screen.findByTestId("rf__wrapper");
  expect(flow.classList.contains("light")).toBe(true);
  document.documentElement.dataset.theme = "dark";
  await waitFor(() => expect(flow.classList.contains("dark")).toBe(true));
});

test("renaming a column re-lays out the nodes so edges attach to the right rows", async () => {
  const { rerender } = render(diagram(meta()));
  await screen.findByTestId("erd-node-projects");
  const laidOut = vi.mocked(layoutErd).mock.calls.length;
  const renamed = meta();
  const projects = renamed.tables[1];
  if (projects) {
    projects.key = "slug";
    projects.columns = { slug: "TEXT" };
  }
  rerender(diagram(renamed));
  await waitFor(() => expect(screen.getByTestId("erd-node-projects").textContent).toContain("slug"));
  expect(vi.mocked(layoutErd).mock.calls.length).toBe(laidOut + 1);
});

test("a self-reference is drawn with the self-loop edge", () => {
  const erd = buildErd(
    {
      ...meta(),
      tables: [
        {
          name: "tasks",
          mode: "files",
          path: "tasks",
          key: "id",
          columns: { id: "TEXT", parent: "TEXT" },
          formats: {},
          references: [{ column: "parent", table: "tasks" }],
          count: 1,
          inDb: true,
        },
      ],
      views: [],
    },
    new Map(),
    new Map(),
    { views: true },
  );
  expect(toEdges(erd, null)).toEqual([
    expect.objectContaining({
      id: "ref:tasks.parent",
      type: "self",
      sourceHandle: "c:parent:out",
      targetHandle: "c:id:in",
    }),
  ]);
});

test("a column named like the header handle gets a handle of its own", () => {
  const m = meta();
  const tasks = m.tables[0];
  if (tasks) {
    tasks.columns = { id: "TEXT", parent: "TEXT" };
    tasks.references = [{ column: "parent", table: "projects" }];
  }
  const edges = toEdges(buildErd(m, new Map(), new Map(), { views: true }), null);
  const ref = edges.find((e) => e.id === "ref:tasks.parent");
  const parent = edges.find((e) => e.id === "parent:tasks__subtasks");
  expect(ref?.sourceHandle).not.toBe(parent?.sourceHandle);
  expect(ref?.sourceHandle).not.toBe(parent?.targetHandle);
});
