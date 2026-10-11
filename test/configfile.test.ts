import { join } from "node:path";
import { expect, test } from "vitest";
import { applySchema, configHash, type Rules, type RuleTarget, setTableGroup } from "../src/configfile.ts";
import { read, tmpRoot, write } from "./helpers.ts";

function config(text: string) {
  const path = join(tmpRoot(), "yamlite.yaml");
  write(path, text);
  return path;
}

test("a group is added to a table, keeping comments and order", () => {
  const path = config("# schema\ntables:\n  people:\n    key: slug # crm\n  tasks: {}\n");
  expect(setTableGroup(path, "people", "CRM")).toBe(true);
  expect(read(path)).toBe("# schema\ntables:\n  people:\n    key: slug # crm\n    group: CRM\n  tasks: {}\n");
});

test("a group is changed in place and removed with null", () => {
  const path = config("tables:\n  people:\n    group: CRM # team\n    key: slug\n");
  setTableGroup(path, "people", "Sales");
  expect(read(path)).toBe("tables:\n  people:\n    group: Sales # team\n    key: slug\n");
  setTableGroup(path, "people", null);
  expect(read(path)).toBe("tables:\n  people:\n    key: slug\n");
});

test("a table with an empty entry gets a block map", () => {
  const path = config("tables:\n  tasks:\n");
  setTableGroup(path, "tasks", "Work");
  expect(read(path)).toBe("tables:\n  tasks:\n    group: Work\n");
});

test("an unchanged group leaves the file alone", () => {
  const path = config("tables:\n  people: { group: CRM }\n");
  expect(setTableGroup(path, "people", "CRM")).toBe(false);
  expect(setTableGroup(path, "tasks", null)).toBe(false);
});

test("a table that is not listed is registered with its group", () => {
  const path = config("tables:\n  people: {}\n");
  expect(setTableGroup(path, "tasks", "Work")).toBe(true);
  expect(read(path)).toBe("tables:\n  people: {}\n  tasks:\n    group: Work\n");
});

const none: Rules = { required: [], values: {}, formats: {}, min: {}, max: {}, references: {} };
const rules = (r: Partial<Rules>): Rules => ({ ...none, ...r });
const tasks = { table: "tasks", path: [] };

test("rules are added to a table, keeping comments and order", () => {
  const text = "# schema\ntables:\n  tasks:\n    key: slug # id\n";
  expect(
    applySchema(text, tasks, { rules: rules({ required: ["title"], values: { status: ["todo", "done"] } }) }),
  ).toBe(
    "# schema\ntables:\n  tasks:\n    key: slug # id\n    required: [title]\n    values:\n      status: [todo, done]\n",
  );
});

test("untouched entries keep their comments", () => {
  const text = "tables:\n  tasks:\n    values:\n      status: [a, b] # keep\n      kind: [x]\n";
  expect(applySchema(text, tasks, { rules: rules({ values: { status: ["a", "b"], kind: ["x", "y"] } }) })).toBe(
    "tables:\n  tasks:\n    values:\n      status: [a, b] # keep\n      kind: [x, y]\n",
  );
});

test("emptied rule keys are removed", () => {
  const text = "tables:\n  tasks:\n    key: id\n    values: { status: [a] }\n    required: [title]\n";
  expect(applySchema(text, tasks, { rules: none })).toBe("tables:\n  tasks:\n    key: id\n");
});

test("min, max, formats and references are set, changed and removed per column", () => {
  const text = "tables:\n  tasks:\n    min: { priority: 1 }\n    references:\n      owner: people # who\n";
  const next = applySchema(text, tasks, {
    rules: rules({
      min: { priority: 2 },
      max: { priority: 5 },
      formats: { due: "date" },
      references: { owner: "people" },
    }),
  });
  expect(next).toBe(
    "tables:\n  tasks:\n    min: { priority: 2 }\n    references:\n      owner: people # who\n    max:\n      priority: 5\n    formats:\n      due: date\n",
  );
});

test("an unchanged rule set is a no-op", () => {
  const text = "tables:\n  tasks:\n    required: [title]\n    references: { owner: people }\n";
  expect(
    applySchema(text, tasks, { rules: rules({ required: ["title"], references: { owner: "people" } }) }),
  ).toBeNull();
});

test("a view's rules are written under expand", () => {
  const text = "tables:\n  projects:\n    expand:\n      milestones:\n        expand:\n          tasks: {}\n";
  expect(
    applySchema(text, { table: "projects", path: ["milestones", "tasks"] }, { rules: rules({ required: ["owner"] }) }),
  ).toBe(
    "tables:\n  projects:\n    expand:\n      milestones:\n        expand:\n          tasks:\n            required: [owner]\n",
  );
});

test("a null view entry becomes a block map", () => {
  const text = "tables:\n  projects:\n    expand:\n      milestones:\n      tags: {}\n";
  expect(
    applySchema(text, { table: "projects", path: ["milestones"] }, { rules: rules({ required: ["title"] }) }),
  ).toBe("tables:\n  projects:\n    expand:\n      milestones:\n        required: [title]\n      tags: {}\n");
});

test("block-style lists stay block: untouched ones byte for byte, changed ones in block style", () => {
  const text =
    "tables:\n  tasks:\n    required:\n      - title # always\n      - owner\n    values:\n      status:\n        - todo\n        - done # last\n";
  expect(
    applySchema(text, tasks, { rules: rules({ required: ["title", "owner"], values: { status: ["todo", "done"] } }) }),
  ).toBeNull();
  expect(
    applySchema(text, tasks, {
      rules: rules({ required: ["title", "owner"], values: { status: ["todo", "done", "wip"] } }),
    }),
  ).toBe(
    "tables:\n  tasks:\n    required:\n      - title # always\n      - owner\n    values:\n      status:\n        - todo\n        - done\n        - wip\n",
  );
  expect(
    applySchema(text, tasks, { rules: rules({ required: ["title"], values: { status: ["todo", "done"] } }) }),
  ).toBe(
    "tables:\n  tasks:\n    required:\n      - title\n    values:\n      status:\n        - todo\n        - done # last\n",
  );
});

test("numeric column keys are matched, not duplicated", () => {
  const text = "tables:\n  tasks:\n    values:\n      1: [x]\n      2: [y]\n";
  expect(applySchema(text, tasks, { rules: rules({ values: { "1": ["x"], "2": ["y"] } }) })).toBeNull();
  expect(applySchema(text, tasks, { rules: rules({ values: { "1": ["x", "z"], "2": ["y"] } }) })).toBe(
    "tables:\n  tasks:\n    values:\n      1: [x, z]\n      2: [y]\n",
  );
  expect(applySchema(text, tasks, { rules: rules({ values: { "2": ["y"] } }) })).toBe(
    "tables:\n  tasks:\n    values:\n      2: [y]\n",
  );
});

test("an unknown table or view is refused", () => {
  const text = "tables:\n  tasks: {}\n";
  expect(() => applySchema(text, { table: "nope", path: [] }, { rules: none })).toThrow(/unknown table: nope/);
  expect(() => applySchema(text, { table: "tasks", path: ["subs"] }, { rules: none })).toThrow(
    /unknown view: tasks__subs/,
  );
});

const edit = (text: string, e: Omit<Parameters<typeof applySchema>[2], "rules">, target: RuleTarget = tasks) =>
  applySchema(text, target, { rules: none, ...e });

test.each([
  {
    name: "a non-unique index starts a block list of flow items",
    text: "tables:\n  tasks:\n    key: id\n",
    indexes: [{ columns: ["status", "due"], unique: false }],
    want: "tables:\n  tasks:\n    key: id\n    indexes:\n      - [status, due]\n",
  },
  {
    name: "a unique index is a flow map",
    text: "tables:\n  people: { key: id }\n  tasks:\n    key: id\n",
    indexes: [{ columns: ["slug"], unique: true }],
    want: "tables:\n  people: { key: id }\n  tasks:\n    key: id\n    indexes:\n      - { columns: [ slug ], unique: true }\n",
  },
  {
    name: "an expression index is written with its expression",
    text: "tables:\n  tasks:\n    key: id\n",
    indexes: [{ expr: "lower(title)", unique: false }],
    want: "tables:\n  tasks:\n    key: id\n    indexes:\n      - {expr: lower(title)}\n",
  },
  {
    name: "a kept index stays byte-identical while another is removed",
    text: "tables:\n  tasks:\n    indexes:\n      - [owner] # by owner\n      - {columns: slug, unique: true}\n      - [due]\n",
    indexes: [
      { columns: ["owner"], unique: false },
      { columns: ["due"], unique: false },
    ],
    want: "tables:\n  tasks:\n    indexes:\n      - [owner] # by owner\n      - [due]\n",
  },
  {
    name: "an existing flow list keeps its style",
    text: "tables:\n  tasks:\n    indexes: [[owner]]\n",
    indexes: [
      { columns: ["owner"], unique: false },
      { columns: ["due"], unique: false },
    ],
    want: "tables:\n  tasks:\n    indexes: [[owner], [due]]\n",
  },
  {
    name: "an emptied list removes the key",
    text: "tables:\n  tasks:\n    key: id\n    indexes:\n      - [owner]\n",
    indexes: [],
    want: "tables:\n  tasks:\n    key: id\n",
  },
  {
    name: "[a] and { columns: a } are the same index",
    text: "tables:\n  tasks:\n    indexes:\n      - { columns: owner }\n      - { expr: lower(title), unique: true }\n",
    indexes: [
      { columns: ["owner"], unique: false },
      { expr: "lower(title)", unique: true },
    ],
    want: null,
  },
])("$name", ({ text, indexes, want }) => {
  expect(edit(text, { indexes })).toBe(want);
});

test("absent indexes and views leave both keys alone", () => {
  const text = "tables:\n  tasks:\n    indexes: [[owner]]\n    expand:\n      subtasks: {}\n";
  expect(edit(text, {})).toBeNull();
});

test("indexes on a view are refused", () => {
  const text = "tables:\n  tasks:\n    expand:\n      subtasks: {}\n";
  expect(() => edit(text, { indexes: [] }, { table: "tasks", path: ["subtasks"] })).toThrow(
    "indexes belong to a table, not a view",
  );
});

test.each([
  {
    name: "a view is added as an empty entry",
    text: "tables:\n  tasks:\n    key: id\n",
    views: ["subtasks"],
    want: "tables:\n  tasks:\n    key: id\n    expand:\n      subtasks: {}\n",
  },
  {
    name: "a removed view goes with its rules and nested views",
    text: "tables:\n  tasks:\n    expand:\n      tags: {} # labels\n      subtasks:\n        required: [title]\n        expand:\n          notes: {}\n",
    views: ["tags"],
    want: "tables:\n  tasks:\n    expand:\n      tags: {} # labels\n",
  },
  {
    name: "removing every view removes expand",
    text: "tables:\n  tasks:\n    key: id\n    expand:\n      subtasks:\n",
    views: [],
    want: "tables:\n  tasks:\n    key: id\n",
  },
  {
    name: "unchanged views are a no-op",
    text: "tables:\n  tasks:\n    expand:\n      subtasks:\n        required: [title]\n      tags:\n",
    views: ["tags", "subtasks"],
    want: null,
  },
])("$name", ({ text, views, want }) => {
  expect(edit(text, { views })).toBe(want);
});

test("a view's own nested views are edited under it", () => {
  const text = "tables:\n  tasks:\n    expand:\n      subtasks:\n        required: [title]\n";
  const target = { table: "tasks", path: ["subtasks"] };
  expect(applySchema(text, target, { rules: rules({ required: ["title"] }), views: ["notes"] })).toBe(
    "tables:\n  tasks:\n    expand:\n      subtasks:\n        required: [title]\n        expand:\n          notes: {}\n",
  );
});

test("the hash follows the text", () => {
  expect(configHash("a")).toBe(configHash("a"));
  expect(configHash("a")).not.toBe(configHash("b"));
});
