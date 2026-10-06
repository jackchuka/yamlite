import { expect, test } from "vitest";
import { screenTitle } from "./screen";

const pages = [{ name: "board", title: "Kanban" }];

test.each([
  ["/t/tasks", "tasks"],
  ["/t/a%20b", "a b"],
  ["/p/board", "Kanban"],
  ["/p/missing", "missing"],
  ["/sql", "SQL console"],
  ["/sync", "Sync"],
  ["/erd", "ERD"],
  ["/", "yamlite"],
])("%s → %s", (path, title) => expect(screenTitle(path, pages)).toBe(title));
