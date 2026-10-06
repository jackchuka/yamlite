import { expect, test } from "vitest";
import { buildErd, TARGET_MISSING } from "./erd";
import type { Meta, TableMeta, TableSchema, ViewMeta } from "./types";

const table = (
  name: string,
  key: string,
  columns: TableMeta["columns"],
  references: TableMeta["references"] = [],
): TableMeta => ({
  name,
  mode: "files",
  path: name,
  key,
  columns,
  formats: {},
  values: {},
  required: [],
  min: {},
  max: {},
  references,
  count: 1,
  inDb: true,
  group: null,
});

const view = (
  name: string,
  parent: string,
  columns: ViewMeta["columns"],
  identity: string[],
  references: ViewMeta["references"] = [],
): ViewMeta => ({
  name,
  table: "tasks",
  parent,
  depth: parent === "tasks" ? 1 : 2,
  columns,
  identity,
  declared: {},
  references,
  values: {},
  required: [],
  formats: {},
  min: {},
  max: {},
  count: 2,
  inDb: true,
});

const meta = (tables: TableMeta[], views: ViewMeta[] = []): Meta => ({
  root: "data",
  db: "db.sqlite",
  configFile: "yamlite.yaml",
  configError: null,
  tables,
  views,
  pages: [],
});

const schema = (
  name: string,
  references: TableSchema["references"] = [],
  views: TableSchema["views"] = [],
): TableSchema => ({
  name,
  mode: "files",
  path: name,
  key: "id",
  inDb: true,
  columns: {},
  declared: {},
  references,
  values: {},
  required: [],
  formats: {},
  min: {},
  max: {},
  indexes: [],
  otherIndexes: [],
  views,
});

const none = new Map<string, number>();
const people = table("people", "id", { id: "INTEGER", name: "TEXT" });
const projects = table("projects", "slug", { slug: "TEXT", email: "TEXT" });

test("a reference without a target points at the target's key, one with a target at that column", () => {
  const tasks = table("tasks", "id", { title: "TEXT", id: "TEXT", owner: "INTEGER", contact: "TEXT" }, [
    { column: "owner", table: "people" },
    { column: "contact", table: "projects", target: "email" },
  ]);
  const erd = buildErd(meta([tasks, people, projects]), new Map(), none, { views: true });
  expect(erd.edges).toEqual([
    {
      id: "ref:tasks.owner",
      kind: "ref",
      source: "tasks",
      sourceColumn: "owner",
      target: "people",
      targetColumn: "id",
      broken: false,
    },
    {
      id: "ref:tasks.contact",
      kind: "ref",
      source: "tasks",
      sourceColumn: "contact",
      target: "projects",
      targetColumn: "email",
      broken: false,
    },
  ]);
  // the key comes first, the rest keep their order
  const node = erd.nodes.find((n) => n.id === "tasks");
  expect(node?.columns.map((c) => [c.name, c.key, c.ref])).toEqual([
    ["id", true, false],
    ["title", false, false],
    ["owner", false, true],
    ["contact", false, true],
  ]);
});

test("a reference with problems is broken and its column carries them", () => {
  const tasks = table("tasks", "id", { id: "TEXT", owner: "INTEGER" }, [{ column: "owner", table: "people" }]);
  const problems = ['owner "9" not found in people.id (a)'];
  const schemas = new Map([["tasks", schema("tasks", [{ column: "owner", table: "people", target: "id", problems }])]]);
  const erd = buildErd(meta([tasks, people]), schemas, none, { views: true });
  expect(erd.edges[0]?.broken).toBe(true);
  expect(erd.nodes[0]?.columns.find((c) => c.name === "owner")?.problems).toEqual(problems);
});

test("a table whose schema has not arrived draws its references without problems", () => {
  const tasks = table("tasks", "id", { id: "TEXT", owner: "INTEGER" }, [{ column: "owner", table: "people" }]);
  const erd = buildErd(meta([tasks, people]), new Map(), none, { views: true });
  expect(erd.edges[0]?.broken).toBe(false);
  expect(erd.nodes[0]?.columns.find((c) => c.name === "owner")?.problems).toEqual([]);
});

test("a reference to a missing table or column draws no edge and marks the column", () => {
  const tasks = table("tasks", "id", { id: "TEXT", team: "TEXT", lead: "TEXT" }, [
    { column: "team", table: "teams" },
    { column: "lead", table: "people", target: "handle" },
  ]);
  const said = ['references.team: table "teams" is not in yamlite.yaml'];
  const schemas = new Map([
    [
      "tasks",
      schema("tasks", [
        { column: "team", table: "teams", target: "id", problems: said },
        { column: "lead", table: "people", target: "handle", problems: [] },
      ]),
    ],
  ]);
  const erd = buildErd(meta([tasks, people]), schemas, none, { views: true });
  expect(erd.edges).toEqual([]);
  const columns = erd.nodes[0]?.columns ?? [];
  expect(columns.find((c) => c.name === "team")?.problems).toEqual(said);
  expect(columns.find((c) => c.name === "lead")?.problems).toEqual([TARGET_MISSING]);
});

test("names shared with Object.prototype members are ordinary names", () => {
  const ctor = table("constructor", "toString", { toString: "TEXT" as const });
  const tasks = table("tasks", "id", { id: "TEXT", a: "TEXT", b: "TEXT" }, [
    { column: "a", table: "constructor" },
    { column: "b", table: "people", target: "valueOf" },
  ]);
  const erd = buildErd(meta([tasks, people, ctor]), new Map(), new Map([["constructor", 1]]), { views: true });
  expect(erd.edges.map((e) => e.id)).toEqual(["ref:tasks.a"]);
  expect(erd.nodes[0]?.columns.find((c) => c.name === "b")?.problems).toEqual([TARGET_MISSING]);
  expect(erd.nodes.find((n) => n.id === "people")?.warnings).toBe(0);
  expect(erd.nodes.find((n) => n.id === "constructor")?.warnings).toBe(1);
});

test("a reference whose column is not in the data yet draws no edge", () => {
  const tasks = table("tasks", "id", { id: "TEXT" }, [{ column: "owner", table: "people" }]);
  const erd = buildErd(meta([tasks, people]), new Map(), none, { views: true });
  expect(erd.edges).toEqual([]);
  expect(erd.nodes[0]?.columns.map((c) => c.name)).toEqual(["id"]);
});

test("a self-reference is an edge to its own node, and warnings are counted per node", () => {
  const tasks = table("tasks", "id", { id: "TEXT", parent: "TEXT" }, [{ column: "parent", table: "tasks" }]);
  const erd = buildErd(meta([tasks]), new Map(), new Map([["tasks", 2]]), { views: true });
  expect(erd.edges).toEqual([
    {
      id: "ref:tasks.parent",
      kind: "ref",
      source: "tasks",
      sourceColumn: "parent",
      target: "tasks",
      targetColumn: "id",
      broken: false,
    },
  ]);
  expect(erd.nodes[0]?.warnings).toBe(2);
});

test("a view is its own node keyed by its identity, joined to its parent, with problems from the root table's schema", () => {
  const tasks = table("tasks", "id", { id: "TEXT" });
  const subtasks = view(
    "tasks__subtasks",
    "tasks",
    { tasks_id: "TEXT", _index: "INTEGER", assignee: "INTEGER" },
    ["tasks_id", "_index"],
    [{ column: "assignee", table: "people" }],
  );
  const steps = view(
    "tasks__subtasks__steps",
    "tasks__subtasks",
    { tasks_id: "TEXT", subtasks_index: "INTEGER", _index: "INTEGER" },
    ["tasks_id", "subtasks_index", "_index"],
  );
  const problems = [
    'tasks__subtasks: assignee "7" not found in people.id (a/0)',
    "view tasks__subtasks is not built: column clash",
  ];
  const schemas = new Map([
    [
      "tasks",
      schema(
        "tasks",
        [],
        [{ name: "tasks__subtasks", parent: "tasks", depth: 1, columns: {}, identity: [], inDb: true, problems }],
      ),
    ],
  ]);
  const erd = buildErd(meta([tasks, people], [subtasks, steps]), schemas, none, { views: true });
  const node = erd.nodes.find((n) => n.id === "tasks__subtasks");
  expect(node?.kind).toBe("view");
  expect(node?.columns.filter((c) => c.key).map((c) => c.name)).toEqual(["tasks_id", "_index"]);
  expect(node?.columns.find((c) => c.name === "assignee")?.problems).toEqual([
    'assignee "7" not found in people.id (a/0)',
  ]);
  expect(erd.edges).toContainEqual({
    id: "parent:tasks__subtasks",
    kind: "parent",
    source: "tasks__subtasks",
    target: "tasks",
    broken: false,
  });
  expect(erd.edges).toContainEqual({
    id: "parent:tasks__subtasks__steps",
    kind: "parent",
    source: "tasks__subtasks__steps",
    target: "tasks__subtasks",
    broken: false,
  });
  expect(erd.edges).toContainEqual(expect.objectContaining({ id: "ref:tasks__subtasks.assignee", broken: true }));
});

test("hiding views drops their nodes and every edge touching them", () => {
  const tasks = table("tasks", "id", { id: "TEXT" });
  const subtasks = view(
    "tasks__subtasks",
    "tasks",
    { tasks_id: "TEXT", assignee: "INTEGER" },
    ["tasks_id"],
    [{ column: "assignee", table: "people" }],
  );
  const erd = buildErd(meta([tasks, people], [subtasks]), new Map(), none, { views: false });
  expect(erd.nodes.map((n) => n.id)).toEqual(["tasks", "people"]);
  expect(erd.edges).toEqual([]);
});
