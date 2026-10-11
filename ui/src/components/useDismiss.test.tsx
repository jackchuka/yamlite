import { act, render, screen } from "@testing-library/react";
import { useState } from "react";
import { flushSync } from "react-dom";
import { expect, test } from "vitest";
import { useDismiss } from "./RecordDrawer";

function Drawer({ onClose }: { onClose: () => void }) {
  useDismiss(onClose);
  return <aside>drawer</aside>;
}

function Harness() {
  const [open, setOpen] = useState(false);
  const [closed, setClosed] = useState(0);
  return (
    <>
      <button type="button" onClick={() => flushSync(() => setOpen(true))}>
        open
      </button>
      {open && <Drawer onClose={() => setClosed((n) => n + 1)} />}
      <output>{`closed ${closed}`}</output>
    </>
  );
}

test("the click that opens a drawer does not also dismiss it", () => {
  render(<Harness />);
  act(() => screen.getByRole("button", { name: "open" }).dispatchEvent(new MouseEvent("click", { bubbles: true })));
  expect(screen.getByText("drawer")).toBeTruthy();
  expect(screen.getByRole("status").textContent).toBe("closed 0");
  act(() => document.body.dispatchEvent(new MouseEvent("click", { bubbles: true })));
  expect(screen.getByRole("status").textContent).toBe("closed 1");
});

function Busy() {
  const [n, setN] = useState(0);
  const [closed, setClosed] = useState(0);
  return (
    <>
      <button type="button" onClick={() => flushSync(() => setN((x) => x + 1))}>
        {`bump ${n}`}
      </button>
      <Drawer onClose={() => setClosed((c) => c + 1)} />
      <output>{`closed ${closed}`}</output>
    </>
  );
}

test("an outside click that re-renders the drawer's parent still dismisses it", () => {
  render(<Busy />);
  act(() => screen.getByRole("button", { name: /bump/ }).dispatchEvent(new MouseEvent("click", { bubbles: true })));
  expect(screen.getByRole("status").textContent).toBe("closed 1");
});
