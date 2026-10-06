import { act, render, screen, within } from "@testing-library/react";
import { expect, test } from "vitest";
import { setMobile } from "@/test/media";
import { FieldDiff } from "./FieldDiff";

const rows = [{ field: "title", a: '"A"', b: '"B"' }];

test("three columns on a wide screen", () => {
  render(<FieldDiff labels={["Current value", "Your edit"]} rows={rows} />);
  expect(screen.getByTestId("field-diff").className).toContain("grid-cols-[auto_1fr_1fr]");
  expect(screen.queryByRole("group", { name: "title" })).toBeNull();
});

test("one block per field on a phone", () => {
  act(() => setMobile(true));
  render(<FieldDiff labels={["Current value", "Your edit"]} rows={rows} />);
  const block = screen.getByRole("group", { name: "title" });
  expect(within(block).getByText("Current value")).toBeTruthy();
  expect(within(block).getByText('"B"')).toBeTruthy();
});
