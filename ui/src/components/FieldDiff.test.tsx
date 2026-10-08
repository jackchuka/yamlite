import { act, render, screen, within } from "@testing-library/react";
import { expect, test } from "vitest";
import { setMobile } from "@/test/media";
import { FieldDiff } from "./FieldDiff";

const rows = [{ field: "title", a: '"A"', b: '"B"' }];

test("three columns on a wide screen", () => {
  render(<FieldDiff labels={["Current value", "Your edit"]} rows={rows} format={String} />);
  expect(screen.getByTestId("field-diff").className).toContain("grid-cols-[auto_1fr_1fr]");
  expect(screen.queryByRole("group", { name: "title" })).toBeNull();
});

test("one block per field on a phone", () => {
  act(() => setMobile(true));
  render(<FieldDiff labels={["Current value", "Your edit"]} rows={rows} format={String} />);
  const block = screen.getByRole("group", { name: "title" });
  expect(within(block).getByText("Current value")).toBeTruthy();
  expect(within(block).getByText('"B"')).toBeTruthy();
});

test("a changed long text gets a line diff under the short values", () => {
  render(
    <FieldDiff
      labels={["Current value", "Your edit"]}
      format={(v) => JSON.stringify(v)}
      rows={[
        { field: "title", a: "A", b: "B" },
        { field: "body", a: "# Notes\n- old line\n", b: "# Notes\n- new line\n" },
      ]}
    />,
  );
  expect(screen.getByTestId("field-diff").textContent).toContain('"A"');
  expect(screen.getByTestId("field-diff").textContent).not.toContain("Notes");
  const body = screen.getByRole("group", { name: "body" });
  expect(within(body).getByText("Current value")).toBeTruthy();
  expect(body.querySelectorAll("mark")).toHaveLength(2);
});

test("an unchanged long text stays a dimmed row", () => {
  render(
    <FieldDiff
      labels={["Kept", "Backup"]}
      format={String}
      rows={[{ field: "body", a: "a\nb", b: "a\nb", dim: true }]}
    />,
  );
  expect(screen.queryByRole("group", { name: "body" })).toBeNull();
  expect(screen.getByTestId("field-diff").textContent).toContain("body");
});
