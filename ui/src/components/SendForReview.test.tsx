import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, expect, test, vi } from "vitest";
import { gitApi, type GitState } from "@/lib/git";
import { SendForReview } from "./SendForReview";

let state: GitState;
vi.mock("@/lib/git", async (orig) => {
  const real = await orig<typeof import("@/lib/git")>();
  return { ...real, useGit: () => state, gitApi: { ...real.gitApi, review: vi.fn() } };
});
vi.mock("@/lib/providers", () => ({ useMeta: () => ({ data: { tables: [{ name: "tasks", mode: "files" }] } }) }));
afterEach(() => vi.clearAllMocks());

const edited: GitState = {
  branch: "main",
  defaultBranch: "main",
  upstream: null,
  namesBranch: false,
  changes: [{ path: "tasks/a.yaml", status: "modified", table: "tasks", records: null }],
};

const show = () =>
  render(
    <QueryClientProvider client={new QueryClient()}>
      <SendForReview />
    </QueryClientProvider>,
  );

test("nothing to send shows nothing", () => {
  state = { ...edited, changes: [] };
  const { container } = show();
  expect(container.textContent).toBe("");
});

test("the dialog stays to show where the changes went once a send empties the count", async () => {
  state = edited;
  vi.mocked(gitApi.review).mockImplementation(async () => {
    state = { ...edited, branch: "review", changes: [] };
    return { branch: "review", steps: [], results: [], url: "https://example.test/pull/1", created: true };
  });
  const { rerender } = show();
  fireEvent.click(screen.getByRole("button", { name: "Send for review" }));
  fireEvent.change(screen.getByRole("textbox", { name: "Title" }), { target: { value: "T" } });
  fireEvent.click(screen.getByRole("button", { name: "Send" }));
  await waitFor(() => expect(screen.getByText("Sent for review.")).toBeTruthy());
  rerender(
    <QueryClientProvider client={new QueryClient()}>
      <SendForReview />
    </QueryClientProvider>,
  );
  expect(screen.getByRole("link", { name: "Open the review" })).toBeTruthy();
  expect(screen.queryByRole("button", { name: "Send for review" })).toBeNull();
});
