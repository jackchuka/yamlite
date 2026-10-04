import { afterEach, expect, test } from "vitest";
import { sql } from "../helpers.ts";
import { type Served, startServe, waitForAsync } from "./helpers.ts";

let t: Served | undefined;
afterEach(async () => {
  await t?.s.close();
  t = undefined;
});

const config = `tables:
  tasks:
    columns: { title: TEXT, project: TEXT }
    references: { project: projects }
    indexes:
      - [project]
      - { columns: [title], unique: true }
      - { columns: [nope] }
  projects:
    path: ./projects.yaml
`;

test("the schema shows declarations, broken references and which indexes exist", async () => {
  t = await startServe(
    {
      "tasks/a.yaml": "title: A\nproject: yamlite\n",
      "tasks/b.yaml": "title: B\nproject: blog\n",
      "projects.yaml": "- id: yamlite\n",
    },
    config,
  );
  const served = t;
  sql(t.db, "CREATE INDEX by_hand ON tasks (title)");
  await waitForAsync(async () => (await served.api("/api/tables/tasks/schema")).status === 200);
  const { body } = await t.api("/api/tables/tasks/schema");
  expect(body).toMatchObject({
    name: "tasks",
    mode: "files",
    path: "tasks",
    files: "tasks/**/*.{yaml,yml}",
    key: "id",
    inDb: true,
  });
  expect(body.columns).toMatchObject({ id: "TEXT", title: "TEXT", project: "TEXT" });
  expect(body.references).toEqual([
    {
      column: "project",
      table: "projects",
      target: "id",
      problems: [expect.stringContaining('"blog" not found in projects.id')],
    },
  ]);
  expect(body.indexes).toEqual([
    expect.objectContaining({ definition: "(project)", columns: ["project"], unique: false, inDb: true }),
    expect.objectContaining({ definition: "unique (title)", unique: true, inDb: true }),
    expect.objectContaining({ definition: "(nope)", inDb: false }),
  ]);
  expect(body.otherIndexes).toEqual(["by_hand"]);
});

test("a table that is not in the database yet has an empty schema", async () => {
  t = await startServe({}, 'tables:\n  later:\n    files: "later/**/*.{yaml,yml}"\n    indexes: [[x]]\n');
  const { status, body } = await t.api("/api/tables/later/schema");
  expect(status).toBe(200);
  expect(body).toMatchObject({ inDb: false, references: [], otherIndexes: [] });
  expect(body.indexes).toEqual([expect.objectContaining({ definition: "(x)", inDb: false })]);
  expect((await t.api("/api/tables/nope/schema")).status).toBe(404);
});
