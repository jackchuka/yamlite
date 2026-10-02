import { fireEvent, render, screen } from "@testing-library/react";
import { expect, test, vi } from "vitest";
import { TableWarnings } from "./TableWarnings";

const items = [
  { table: "tasks", key: "a", view: null, text: '"n" does not match column type TEXT' },
  { table: "tasks", key: null, view: null, text: 'assignee "9" not found in people.id (b, c)' },
  { table: "tasks", key: null, view: "tasks__checklist", text: 'owner "carol" not found in people.id (a/0)' },
];

test("nothing is shown without warnings", () => {
  const { container } = render(<TableWarnings items={[]} onOpenRecord={() => {}} />);
  expect(container.textContent).toBe("");
});

test("the button counts the warnings and opens their messages with links", () => {
  const open = vi.fn();
  render(<TableWarnings items={items} onOpenRecord={open} />);
  fireEvent.click(screen.getByRole("button", { name: /3 件の警告/ }));
  expect(screen.getByText('assignee "9" not found in people.id (b, c)')).toBeTruthy();
  expect(screen.getByRole("link", { name: "tasks__checklist" }).getAttribute("href")).toBe("#/t/tasks__checklist");
  fireEvent.click(screen.getByRole("button", { name: "a" }));
  expect(open).toHaveBeenCalledWith("a");
});
