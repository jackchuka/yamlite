import { fireEvent, render } from "@testing-library/react";
import { beforeAll, expect, test } from "vitest";
import { Grid } from "./Grid";

// jsdom has no layout; give the scroll container a size so the virtualizer renders rows
beforeAll(() => {
  Object.defineProperty(HTMLElement.prototype, "offsetHeight", { configurable: true, value: 400 });
  Object.defineProperty(HTMLElement.prototype, "offsetWidth", { configurable: true, value: 800 });
});

test("only a flagged row's key cell carries the labelled warning mark", () => {
  const rows = [
    { id: "a", n: 1 },
    { id: "b", n: 2 },
  ];
  const { container } = render(
    <Grid
      columns={[
        { name: "id", type: "TEXT" },
        { name: "n", type: "INTEGER" },
      ]}
      rows={rows}
      keyCol="id"
      flagged={new Set(["b"])}
    />,
  );
  expect(container.querySelector('[data-key="b"] [aria-label="has warnings"]')?.textContent).toBe("⚠");
  expect(container.querySelector('[data-key="a"] [aria-label="has warnings"]')).toBeNull();
});

test("rowId names the rows and onSelect receives the row", () => {
  const rows = [
    { projects_id: "website", idx: 0, title: "Design" },
    { projects_id: "website", idx: 1, title: "Launch" },
  ];
  const picked: unknown[] = [];
  const { container } = render(
    <Grid
      columns={[
        { name: "projects_id", type: "TEXT" },
        { name: "idx", type: "INTEGER" },
        { name: "title", type: "TEXT" },
      ]}
      rows={rows}
      keyCol="projects_id"
      rowId={(r) => `${String(r.projects_id)}/${String(r.idx)}`}
      onSelect={(_key, row) => picked.push(row)}
    />,
  );
  fireEvent.click(container.querySelector('[data-key="website/1"]') as HTMLElement);
  expect(picked).toEqual([rows[1]]);
});
