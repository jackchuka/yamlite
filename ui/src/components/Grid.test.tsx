import { act, fireEvent, render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { beforeAll, expect, test, vi } from "vitest";
import { setMobile } from "@/test/media";
import { Grid } from "./Grid";

vi.mock("@tanstack/react-router", () => ({
  Link: ({
    params,
    search,
    children,
    ...rest
  }: {
    params: { table: string };
    search: unknown;
    children: ReactNode;
  }) => (
    <a href="#" data-table={params.table} data-search={JSON.stringify(search)} {...rest}>
      {children}
    </a>
  ),
}));
vi.mock("@/lib/providers", () => ({ useMeta: () => ({ data: { tables: [{ name: "people", key: "id" }] } }) }));

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
      flagged={new Map([["b", ['"n" does not match column type TEXT', "second"]]])}
    />,
  );
  const mark = container.querySelector('[data-key="b"] [aria-label="has warnings"]');
  expect(mark?.textContent).toBe("⚠");
  expect(mark?.getAttribute("title")).toBe('"n" does not match column type TEXT\nsecond');
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

test("a reference cell links each value to its record without selecting the row", () => {
  const onSelect = vi.fn();
  render(
    <Grid
      columns={[
        { name: "id", type: "TEXT" },
        { name: "owner", type: "TEXT", reference: { column: "owner", table: "people" } },
        { name: "reviewers", type: "JSON", reference: { column: "reviewers", table: "people" } },
        { name: "email", type: "TEXT", reference: { column: "email", table: "people", target: "email" } },
      ]}
      rows={[{ id: "a", owner: "ann", reviewers: ["bob", "cy"], email: "a@x", missing: null }]}
      keyCol="id"
      onSelect={onSelect}
    />,
  );
  const ann = screen.getByRole("link", { name: "open people ann" });
  expect(ann.dataset).toMatchObject({ table: "people", search: JSON.stringify({ key: "ann" }) });
  expect(screen.getByRole("link", { name: "open people cy" }).dataset.search).toBe(JSON.stringify({ key: "cy" }));
  expect(screen.getByRole("link", { name: "open people a@x" }).dataset.search).toBe(
    JSON.stringify({ filter: [{ col: "email", op: "eq", value: "a@x" }] }),
  );
  fireEvent.click(ann);
  expect(onSelect).not.toHaveBeenCalled();
});

test("an empty reference cell is not a link", () => {
  render(
    <Grid
      columns={[
        { name: "id", type: "TEXT" },
        { name: "owner", type: "TEXT", reference: { column: "owner", table: "people" } },
      ]}
      rows={[{ id: "a", owner: null }]}
      keyCol="id"
    />,
  );
  expect(screen.queryByRole("link")).toBeNull();
});

test("the key column stays in place when scrolled sideways", () => {
  render(
    <Grid
      columns={[
        { name: "id", type: "TEXT" },
        { name: "title", type: "TEXT" },
      ]}
      rows={[{ id: "a", title: "A" }]}
      keyCol="id"
    />,
  );
  const [keyHeader, other] = screen.getAllByRole("columnheader");
  expect(keyHeader?.className).toContain("sticky");
  expect(other?.className).not.toContain("sticky");
  const [keyCell] = screen.getAllByRole("gridcell");
  expect(keyCell?.className).toContain("sticky");
});

test("rows are taller on a phone", () => {
  act(() => setMobile(true));
  const { container } = render(<Grid columns={[{ name: "id", type: "TEXT" }]} rows={[{ id: "a" }]} keyCol="id" />);
  expect(container.querySelector<HTMLElement>('[data-key="a"]')?.style.height).toBe("44px");
});

test("a row's warning mark is big enough to tap on a phone", () => {
  const { container } = render(
    <Grid
      columns={[{ name: "id", type: "TEXT" }]}
      rows={[{ id: "b" }]}
      keyCol="id"
      flagged={new Map([["b", ["w"]]])}
    />,
  );
  const mark = container.querySelector('[aria-label="has warnings"]');
  expect(mark?.className).toContain("max-md:min-w-8");
  expect(mark?.className).toContain("max-md:min-h-8");
});
