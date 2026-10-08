import { fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, test, vi } from "vitest";
import type { GitState } from "@/lib/git";
import { GitFooter } from "./Sidebar";

let gitState: GitState | null = null;
vi.mock("@/lib/git", async (orig) => ({
  ...(await orig<typeof import("@/lib/git")>()),
  useGit: () => gitState,
}));
vi.mock("./ReviewDialog", () => ({
  ReviewDialog: ({ open }: { open: boolean }) => (open ? <div role="dialog" aria-label="review" /> : null),
}));
afterEach(() => {
  gitState = null;
});

const change = {
  path: "tasks/a.yaml",
  status: "modified" as const,
  table: "tasks",
  records: [{ key: "a", kind: "modified" as const, fields: ["title"] }],
};

test("nothing outside a git repository with an origin", () => {
  const { container } = render(<GitFooter />);
  expect(container.innerHTML).toBe("");
});

test("shows the branch and the number of changes, and opens the dialog", () => {
  gitState = {
    branch: "main",
    defaultBranch: "main",
    upstream: "origin/main",
    changes: [change, { ...change, path: "tasks/b.yaml" }],
  };
  render(<GitFooter />);
  expect(screen.getByText("main")).toBeTruthy();
  expect(screen.getByText("2 changes")).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: "Send for review" }));
  expect(screen.getByRole("dialog", { name: "review" })).toBeTruthy();
});

test("the button is disabled without changes and on a detached HEAD", () => {
  gitState = { branch: "main", defaultBranch: "main", upstream: null, changes: [] };
  const { unmount } = render(<GitFooter />);
  expect(screen.getByText("no changes")).toBeTruthy();
  expect((screen.getByRole("button", { name: "Send for review" }) as HTMLButtonElement).disabled).toBe(true);
  unmount();
  gitState = { branch: null, defaultBranch: "main", upstream: null, changes: [change] };
  render(<GitFooter />);
  expect(screen.getByText("no branch")).toBeTruthy();
  expect((screen.getByRole("button", { name: "Send for review" }) as HTMLButtonElement).disabled).toBe(true);
});
