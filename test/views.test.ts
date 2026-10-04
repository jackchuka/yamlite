import { describe, expect, test } from "vitest";
import { join } from "node:path";
import { type EngineContext, type SyncOptions, syncTable } from "../src/engine.ts";
import { Store } from "../src/store.ts";
import type { ExpandSpec, TableSpec } from "../src/types.ts";
import { buildView, type ViewParent } from "../src/views.ts";
import { sql, tmpRoot, write } from "./helpers.ts";

const root: ViewParent = { name: "projects", identity: [{ from: "id", as: "projects_id", type: "TEXT" }] };
const expand = (field: string, extra: Partial<ExpandSpec> = {}): ExpandSpec => ({
  field,
  name: `projects__${field}`,
  columns: {},
  formats: {},
  references: [],
  expand: [],
  ...extra,
});

describe("buildView", () => {
  test("an array of maps becomes one column per field after the identity", () => {
    const def = buildView(expand("milestones"), root, [
      [{ title: "Design", points: 3n }, { title: "Launch" }],
      null,
      "not json",
    ]);
    expect(def.identity).toEqual(["projects_id", "idx"]);
    expect(def.columns).toEqual({ projects_id: "TEXT", idx: "INTEGER", title: "TEXT", points: "INTEGER" });
    expect(def.sql).toBe(
      `CREATE VIEW "projects__milestones" AS SELECT p."id" AS "projects_id", CAST(e.key AS INTEGER) AS "idx", ` +
        `CASE WHEN e.type = 'object' THEN json_extract(e.value, '$."title"') END AS "title", ` +
        `CASE WHEN e.type = 'object' THEN json_extract(e.value, '$."points"') END AS "points" ` +
        `FROM "projects" p, json_each(CASE WHEN json_valid(p."milestones") THEN CASE WHEN json_type(p."milestones") IN ('array', 'object') THEN p."milestones" END END) e`,
    );
    expect(def.next).toEqual({
      name: "projects__milestones",
      identity: [
        { from: "projects_id", as: "projects_id", type: "TEXT" },
        { from: "idx", as: "milestones_idx", type: "INTEGER" },
      ],
    });
    expect(def.fields.get("title")).toEqual(["Design", "Launch"]);
    expect(def.warnings).toEqual([]);
  });

  test("a map of maps is keyed by text, and so is a mix of arrays and maps", () => {
    const maps = buildView(expand("milestones"), root, [{ design: { points: 1n }, launch: { points: 2n } }]);
    expect(maps.identity).toEqual(["projects_id", "key"]);
    expect(maps.columns).toEqual({ projects_id: "TEXT", key: "TEXT", points: "INTEGER" });
    expect(maps.sql).toContain(`CAST(e.key AS TEXT) AS "key"`);
    expect(buildView(expand("milestones"), root, [[{ a: 1n }], { b: { a: 2n } }]).identity).toEqual([
      "projects_id",
      "key",
    ]);
  });

  test("elements that are not maps go to a value column", () => {
    const scalars = buildView(expand("tags"), root, [["a", "b"]]);
    expect(scalars.columns).toEqual({ projects_id: "TEXT", idx: "INTEGER", value: "TEXT" });
    expect(scalars.sql).toContain(`CASE WHEN e.type <> 'object' THEN e.value END AS "value"`);
    const mixed = buildView(expand("tags"), root, [[{ title: "x" }, "y"]]);
    expect(mixed.columns).toEqual({ projects_id: "TEXT", idx: "INTEGER", title: "TEXT", value: "TEXT" });
  });

  test("declared types are cast, except JSON, and exist without data", () => {
    const def = buildView(
      expand("milestones", { columns: { points: "INTEGER", done: "BOOLEAN", meta: "JSON", note: "TEXT" } }),
      root,
      [[{ points: "3", done: true, meta: { a: 1n } }]],
    );
    expect(def.columns).toEqual({
      projects_id: "TEXT",
      idx: "INTEGER",
      points: "INTEGER",
      done: "BOOLEAN",
      meta: "JSON",
      note: "TEXT",
    });
    expect(def.sql).toContain(
      `CAST(CASE WHEN e.type = 'object' THEN json_extract(e.value, '$."points"') END AS INTEGER) AS "points"`,
    );
    expect(def.sql).toContain(
      `CAST(CASE WHEN e.type = 'object' THEN json_extract(e.value, '$."done"') END AS INTEGER) AS "done"`,
    );
    expect(def.sql).toContain(`CASE WHEN e.type = 'object' THEN json_extract(e.value, '$."meta"') END AS "meta"`);
    expect(def.sql).toContain(
      `CAST(CASE WHEN e.type = 'object' THEN json_extract(e.value, '$."note"') END AS TEXT) AS "note"`,
    );
    expect(def.sql).not.toContain("AS JSON");
  });

  test("a field named like an identity or value column is hidden with a warning", () => {
    const def = buildView(expand("milestones"), root, [[{ idx: 1n, projects_id: "x", title: "t" }]]);
    expect(Object.keys(def.columns)).toEqual(["projects_id", "idx", "title"]);
    expect(def.warnings).toEqual([
      'view projects__milestones: field "idx" hidden by the identity column',
      'view projects__milestones: field "projects_id" hidden by the identity column',
    ]);
    expect(buildView(expand("tags"), root, [[{ value: 1n }, "s"]]).warnings).toEqual([
      'view projects__tags: field "value" hidden by the value column',
    ]);
  });

  test("a declared type for the value column casts it without a warning", () => {
    const def = buildView(expand("scores", { columns: { value: "INTEGER" } }), root, [[1n, 2n]]);
    expect(def.warnings).toEqual([]);
    expect(def.columns.value).toBe("INTEGER");
    expect(def.sql).toContain(`CAST(CASE WHEN e.type <> 'object' THEN e.value END AS INTEGER) AS "value"`);
    expect(
      buildView(expand("scores", { columns: { value: "INTEGER" } }), root, [[{ value: 1n }, 2n]]).warnings,
    ).toEqual(['view projects__scores: field "value" hidden by the value column']);
  });

  test("a declared type for an identity column is not a field", () => {
    const def = buildView(expand("milestones", { columns: { idx: "TEXT" } }), root, [[{ title: "t" }]]);
    expect(def.warnings).toEqual([]);
    expect(def.columns).toEqual({ projects_id: "TEXT", idx: "INTEGER", title: "TEXT" });
  });

  test("fields named like Object.prototype members are ordinary fields", () => {
    const def = buildView(expand("milestones"), root, [[{ constructor: "x", toString: 1n }]]);
    expect(def.sql).not.toContain("function");
    expect(def.columns).toMatchObject({ constructor: "TEXT", toString: "INTEGER" });
  });

  test("identifiers and JSON paths are quoted", () => {
    const def = buildView(expand(`it's`), root, [[{ [`a "b".c`]: 1n }]]);
    expect(def.sql).toContain(`json_extract(e.value, '$."a \\"b\\".c"') END AS "a ""b"".c"`);
    expect(def.sql).toContain(`p."it's"`);
  });

  test("a nested view inherits its parent's identity", () => {
    const milestones = buildView(expand("milestones"), root, [[{ tasks: [{ owner: "ann" }] }]]);
    const tasks = buildView(
      { field: "tasks", name: "projects__milestones__tasks", columns: {}, formats: {}, references: [], expand: [] },
      milestones.next,
      milestones.fields.get("tasks") ?? [],
    );
    expect(tasks.identity).toEqual(["projects_id", "milestones_idx", "idx"]);
    expect(tasks.sql).toContain(`p."projects_id" AS "projects_id", p."idx" AS "milestones_idx"`);
    expect(tasks.sql).toContain(`FROM "projects__milestones" p`);
  });

  test("a view nested under a view of the same field gets unique identity names", () => {
    const child = (name: string): ExpandSpec => ({
      field: "children",
      name,
      columns: {},
      formats: {},
      references: [],
      expand: [],
    });
    const one = buildView(child("projects__children"), root, [[{ children: [{ children: [{ name: "x" }] }] }]]);
    const two = buildView(child("projects__children__children"), one.next, one.fields.get("children") ?? []);
    const three = buildView(
      child("projects__children__children__children"),
      two.next,
      two.fields.get("children") ?? [],
    );
    expect(two.identity).toEqual(["projects_id", "children_idx", "idx"]);
    expect(three.identity).toEqual(["projects_id", "children_idx", "children_idx_2", "idx"]);
    expect(three.next.identity.map((c) => c.as)).toEqual([
      "projects_id",
      "children_idx",
      "children_idx_2",
      "children_idx_3",
    ]);
  });
});

function setup(list: ExpandSpec[]) {
  const root = tmpRoot();
  const stateDir = join(root, ".yamlite");
  const db = join(stateDir, "db.sqlite");
  const ctx: EngineContext = { store: new Store(db, { busyTimeoutMs: 0 }), stateDir };
  const spec: TableSpec = {
    name: "projects",
    path: join(root, "projects"),
    mode: "files",
    glob: "**/*.{yaml,yml}",
    codec: "yaml",
    body: null,
    key: "id",
    columns: {},
    formats: {},
    indexes: [],
    references: [],
    persisted: false,
    exclude: [],
    expand: list,
  };
  return {
    db,
    spec,
    file: (key: string) => join(root, "projects", `${key}.yaml`),
    sync: (o: SyncOptions = {}) => syncTable(ctx, spec, o),
  };
}

const tasks: ExpandSpec = {
  field: "tasks",
  name: "projects__milestones__tasks",
  columns: {},
  formats: {},
  references: [],
  expand: [],
};
const views = (db: string) =>
  sql(db, "SELECT name FROM sqlite_schema WHERE type = 'view' ORDER BY name").map((r) => r.name);
const created = (name: string) => ({ op: "createView", name, definition: name });
const dropped = (name: string) => ({ op: "dropView", name, definition: name });

describe("reconcileViews", () => {
  test("creates nested views, then does nothing", () => {
    const t = setup([expand("milestones", { expand: [tasks] })]);
    write(
      t.file("website"),
      "milestones:\n  - title: Design\n    tasks:\n      - owner: ann\n      - owner: bob\n  - title: Launch\n",
    );
    const r = t.sync();
    expect(r.schema).toEqual([created("projects__milestones"), created("projects__milestones__tasks")]);
    expect(sql(t.db, "SELECT * FROM projects__milestones ORDER BY idx")).toEqual([
      { projects_id: "website", idx: 0, title: "Design", tasks: '[{"owner":"ann"},{"owner":"bob"}]' },
      { projects_id: "website", idx: 1, title: "Launch", tasks: null },
    ]);
    expect(sql(t.db, "SELECT * FROM projects__milestones__tasks ORDER BY idx")).toEqual([
      { projects_id: "website", milestones_idx: 0, idx: 0, owner: "ann" },
      { projects_id: "website", milestones_idx: 0, idx: 1, owner: "bob" },
    ]);
    expect(t.sync().schema).toEqual([]);
  });

  test("a new element field replaces only the view that has it", () => {
    const t = setup([expand("milestones", { expand: [tasks] })]);
    write(t.file("website"), "milestones:\n  - title: Design\n    tasks:\n      - owner: ann\n");
    t.sync();
    write(t.file("blog"), "milestones:\n  - title: Draft\n    due: soon\n");
    expect(t.sync().schema).toEqual([dropped("projects__milestones"), created("projects__milestones")]);
    expect(sql(t.db, "SELECT due FROM projects__milestones WHERE projects_id = 'blog'")).toEqual([{ due: "soon" }]);
    expect(sql(t.db, "SELECT owner FROM projects__milestones__tasks")).toEqual([{ owner: "ann" }]);
  });

  test("removing a declaration drops the view and the views under it", () => {
    const t = setup([expand("milestones", { expand: [tasks] })]);
    write(t.file("website"), "milestones:\n  - tasks: [{ owner: ann }]\n");
    t.sync();
    t.spec.expand = [];
    expect(t.sync().schema).toEqual([dropped("projects__milestones__tasks"), dropped("projects__milestones")]);
    expect(views(t.db)).toEqual([]);
    expect(sql(t.db, "SELECT count(*) AS n FROM _yamlite_views")).toEqual([{ n: 0 }]);
  });

  test("a field that is not a JSON column is a warning, and so is nothing under it", () => {
    const t = setup([expand("title", { expand: [{ ...tasks, name: "projects__title__tasks" }] })]);
    write(t.file("website"), "title: Website\n");
    const r = t.sync();
    expect(r.ok).toBe(true);
    expect(r.warnings).toEqual(['view projects__title not created: no JSON column "title"']);
    expect(r.schema).toEqual([]);
    expect(views(t.db)).toEqual([]);
  });

  test("an object yamlite did not create is left alone", () => {
    const t = setup([expand("milestones")]);
    sql(t.db, "CREATE VIEW projects__milestones AS SELECT 1 AS mine");
    write(t.file("website"), "milestones: [{ title: Design }]\n");
    const r = t.sync();
    expect(r.warnings).toEqual([
      "view projects__milestones not created: a view with that name is not managed by yamlite",
    ]);
    expect(sql(t.db, "SELECT * FROM projects__milestones")).toEqual([{ mine: 1 }]);
  });

  test("a view dropped by hand is created again", () => {
    const t = setup([expand("milestones")]);
    write(t.file("website"), "milestones: [{ title: Design }]\n");
    t.sync();
    sql(t.db, "DROP VIEW projects__milestones");
    expect(t.sync().schema).toEqual([created("projects__milestones")]);
  });

  test("a table that took a registered view's name is left alone", () => {
    const t = setup([expand("milestones")]);
    write(t.file("website"), "milestones: [{ title: Design }]\n");
    t.sync();
    sql(t.db, "DROP VIEW projects__milestones");
    sql(t.db, "CREATE TABLE projects__milestones (x)");
    sql(t.db, "INSERT INTO projects__milestones VALUES (1)");
    const r = t.sync();
    expect(r.ok).toBe(true);
    expect(r.warnings).toEqual([
      "view projects__milestones not created: a table with that name is not managed by yamlite",
    ]);
    expect(sql(t.db, "SELECT x FROM projects__milestones")).toEqual([{ x: 1 }]);
    expect(sql(t.db, "SELECT count(*) AS n FROM _yamlite_views")).toEqual([{ n: 0 }]);
  });

  test("a stale registration whose name became a table does not break sync", () => {
    const t = setup([expand("milestones")]);
    write(t.file("website"), "milestones: [{ title: Design }]\n");
    t.sync();
    sql(t.db, "DROP VIEW projects__milestones");
    sql(t.db, "CREATE TABLE projects__milestones (x)");
    t.spec.expand = [];
    const r = t.sync();
    expect(r.ok).toBe(true);
    expect(r.schema).toEqual([]);
    expect(sql(t.db, "SELECT count(*) AS n FROM _yamlite_views")).toEqual([{ n: 0 }]);
  });

  test("status plans view changes without creating them", () => {
    const t = setup([]);
    write(t.file("website"), "milestones: [{ title: Design }]\n");
    t.sync();
    t.spec.expand = [expand("milestones")];
    expect(t.sync({ dryRun: true }).schema).toEqual([created("projects__milestones")]);
    expect(views(t.db)).toEqual([]);
    expect(t.sync().schema).toEqual([created("projects__milestones")]);
  });

  test("rows that are not arrays or maps yield nothing", () => {
    const t = setup([expand("milestones")]);
    write(t.file("a"), "milestones: [x, { title: T }]\n");
    write(t.file("b"), "milestones: [{ title: U }]\n");
    write(t.file("c"), "milestones: { title: V }\n");
    t.sync();
    sql(t.db, "UPDATE projects SET milestones = 'oops' WHERE id = 'b'");
    expect(
      sql(t.db, "SELECT projects_id, key, title, value FROM projects__milestones ORDER BY projects_id, key"),
    ).toEqual([
      { projects_id: "a", key: "0", title: null, value: "x" },
      { projects_id: "a", key: "1", title: "T", value: null },
      { projects_id: "c", key: "title", title: null, value: "V" },
    ]);
  });

  test("odd field names are quoted", () => {
    const t = setup([expand("milestones")]);
    write(t.file("a"), `milestones:\n  - "it's \\"odd\\".x y": 1\n`);
    t.sync();
    expect(sql(t.db, `SELECT "it's ""odd"".x y" AS v FROM projects__milestones`)).toEqual([{ v: 1 }]);
  });

  test("works on list tables", () => {
    const root = tmpRoot();
    const stateDir = join(root, ".yamlite");
    const db = join(stateDir, "db.sqlite");
    const spec: TableSpec = {
      name: "people",
      path: join(root, "people.yaml"),
      mode: "list",
      glob: null,
      codec: "yaml",
      body: null,
      key: "id",
      columns: {},
      formats: {},
      indexes: [],
      references: [],
      persisted: false,
      exclude: [],
      expand: [{ field: "roles", name: "people__roles", columns: {}, formats: {}, references: [], expand: [] }],
    };
    write(spec.path, "- id: 1\n  roles: [admin, editor]\n");
    syncTable({ store: new Store(db, { busyTimeoutMs: 0 }), stateDir }, spec);
    expect(sql(db, "SELECT * FROM people__roles ORDER BY idx")).toEqual([
      { people_id: 1, idx: 0, value: "admin" },
      { people_id: 1, idx: 1, value: "editor" },
    ]);
  });

  test("views nested under views of the same field can be queried", () => {
    const child = (name: string, expand: ExpandSpec[] = []): ExpandSpec => ({
      field: "children",
      name,
      columns: {},
      formats: {},
      references: [],
      expand,
    });
    const t = setup([
      child("projects__children", [
        child("projects__children__children", [child("projects__children__children__children")]),
      ]),
    ]);
    write(t.file("website"), "children:\n  - children:\n      - children:\n          - name: x\n");
    const r = t.sync();
    expect(r.warnings).toEqual([]);
    expect(sql(t.db, "SELECT * FROM projects__children__children__children")).toEqual([
      { projects_id: "website", children_idx: 0, children_idx_2: 0, idx: 0, name: "x" },
    ]);
  });

  test("fields named like Object.prototype members can be queried", () => {
    const t = setup([expand("milestones")]);
    write(t.file("website"), "milestones:\n  - constructor: x\n    toString: 1\n");
    const r = t.sync();
    expect(r.warnings).toEqual([]);
    expect(sql(t.db, `SELECT "constructor", "toString" FROM projects__milestones`)).toEqual([
      { constructor: "x", toString: 1 },
    ]);
  });

  test("views survive a column type change of their table", () => {
    const t = setup([expand("milestones")]);
    write(t.file("website"), "title: 1\nmilestones: [{ title: Design }]\n");
    t.sync();
    t.spec.columns = { title: "TEXT" };
    const r = t.sync();
    expect(r.schema.map((c) => c.op)).toEqual(["alterColumn"]);
    expect(sql(t.db, "SELECT title FROM projects__milestones")).toEqual([{ title: "Design" }]);
  });
});
