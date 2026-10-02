import { render } from "@testing-library/react";
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
