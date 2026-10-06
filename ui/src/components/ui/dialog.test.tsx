import { render, screen } from "@testing-library/react";
import { expect, test } from "vitest";
import { Dialog, DialogContent, DialogFooter, DialogTitle } from "./dialog";

test("a dialog fills a phone's screen and keeps its actions at the bottom", () => {
  render(
    <Dialog open>
      <DialogContent aria-describedby={undefined}>
        <DialogTitle>t</DialogTitle>
        <DialogFooter>actions</DialogFooter>
      </DialogContent>
    </Dialog>,
  );
  expect(screen.getByRole("dialog").className).toContain("max-md:h-dvh");
  expect(screen.getByText("actions").className).toContain("max-md:sticky");
  // a column layout, so the footer's auto margin pushes it to the bottom of a short dialog
  expect(screen.getByRole("dialog").className).toContain("max-md:flex-col");
});
