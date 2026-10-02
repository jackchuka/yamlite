import { fireEvent, render, screen } from "@testing-library/react";
import { expect, test } from "vitest";
import { Cell } from "./Cell";

test("chips and the overflow count", () => {
  render(<Cell value={["a", "b", "c", "d"]} type="JSON" column="tags" rowKey="x" />);
  expect(screen.getByText("a")).toBeTruthy();
  expect(screen.getByText("+1")).toBeTruthy();
});

test("a nested value is a button that opens the tree", () => {
  render(<Cell value={{ owner: "alice", links: ["l1"] }} type="JSON" column="meta" rowKey="x" />);
  const trigger = screen.getByRole("button", { name: /owner, links\[1\]/ });
  fireEvent.pointerDown(trigger);
  fireEvent.click(trigger);
  expect(screen.getByText('"alice"')).toBeTruthy();
});

test("null is a dash", () => {
  render(<Cell value={null} type="TEXT" column="t" rowKey="x" />);
  expect(screen.getByText("—")).toBeTruthy();
});
