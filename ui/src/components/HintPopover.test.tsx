import { fireEvent, render, screen } from "@testing-library/react";
import { expect, test, vi } from "vitest";
import { HintPopover } from "./HintPopover";

test("a tap shows the hint without reaching the row behind it", () => {
  const onRow = vi.fn();
  render(
    <div role="row" onClick={onRow}>
      <HintPopover label="has warnings" hint="owner not found">
        ⚠
      </HintPopover>
    </div>,
  );
  fireEvent.click(screen.getByRole("button", { name: "has warnings" }));
  expect(screen.getByText("owner not found")).toBeTruthy();
  expect(onRow).not.toHaveBeenCalled();
});

test("a tap inside a link does not follow it", () => {
  render(
    <a href="#/elsewhere">
      title
      <HintPopover label="3 warnings" hint="3 件の警告">
        3
      </HintPopover>
    </a>,
  );
  const event = new MouseEvent("click", { bubbles: true, cancelable: true });
  screen.getByRole("button", { name: "3 warnings" }).dispatchEvent(event);
  expect(event.defaultPrevented).toBe(true);
});
