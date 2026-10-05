import { join } from "node:path";
import { expect, test } from "vitest";
import { setTableGroup } from "../src/configfile.ts";
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
