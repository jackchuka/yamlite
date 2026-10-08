import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, expect, test, vi } from "vitest";
import type { Proposal } from "@/lib/agent";
import { ProposalCard } from "./ProposalCard";

const apply = vi.hoisted(() => vi.fn());
const discard = vi.hoisted(() => vi.fn());
vi.mock("@/lib/agent", async (orig) => ({
  ...(await orig<typeof import("@/lib/agent")>()),
  agentApi: { apply, discard },
  invalidateProposals: vi.fn(),
}));
afterEach(cleanup);

const proposal: Proposal = {
  id: "p1",
  conversationId: "c1",
  title: "errand を完了に",
  status: "pending",
  createdAt: "",
  rows: [
    {
      table: "tasks",
      key: "buy-milk",
      op: "update",
      before: { done: false },
      after: { done: true },
      changed: ["done"],
    },
    { table: "tasks", key: "old", op: "delete", before: { title: "Old" }, after: null, changed: [] },
  ],
  warnings: ["tasks/buy-milk: title is required"],
  sql: "UPDATE tasks SET done = 1",
};

const renderCard = (p: Proposal) =>
  render(
    <QueryClientProvider client={new QueryClient()}>
      <ProposalCard proposal={p} />
    </QueryClientProvider>,
  );

test("shows rows, warnings and the SQL, and applies", async () => {
  apply.mockResolvedValue({ ...proposal, status: "applied" });
  renderCard(proposal);
  expect(screen.getByText("errand を完了に")).toBeTruthy();
  expect(screen.getByText("buy-milk")).toBeTruthy();
  expect(screen.getByText("Delete")).toBeTruthy();
  expect(screen.getByText(/title is required/)).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: "Apply 2 changes" }));
  await waitFor(() => expect(apply).toHaveBeenCalledWith("p1"));
});

test("discards", async () => {
  discard.mockResolvedValue({ ...proposal, status: "discarded" });
  renderCard(proposal);
  fireEvent.click(screen.getByRole("button", { name: "Discard" }));
  await waitFor(() => expect(discard).toHaveBeenCalledWith("p1"));
});

test("settled proposals show their outcome and no buttons", () => {
  renderCard({ ...proposal, warnings: [], status: "stale", stale: ["tasks/buy-milk"] });
  expect(screen.queryByRole("button", { name: /適用/ })).toBeNull();
  expect(screen.getByText(/original data changed/)).toBeTruthy();
  expect(screen.getByText(/tasks\/buy-milk/)).toBeTruthy();
});

test("a change inside a JSON column lists only the added elements", () => {
  const old = [
    { question: "Q-1", note: "a" },
    { question: "Q-2", note: "b" },
  ];
  const next = [...old, { question: "Q-3", note: "c" }, { question: "Q-4", note: "d" }];
  renderCard({
    ...proposal,
    warnings: [],
    rows: [
      {
        table: "forms",
        key: "f1",
        op: "update",
        before: { answers: old },
        after: { answers: next },
        changed: ["answers"],
      },
    ],
  });
  expect(screen.getAllByText("added")).toHaveLength(2);
  expect(screen.getByText("answers › Q-3")).toBeTruthy();
  expect(screen.getByText("answers › Q-4")).toBeTruthy();
  expect(screen.queryByText(/Q-1/)).toBeNull();
});

test("a JSON column that only reorders keys says there is no visible difference", () => {
  renderCard({
    ...proposal,
    warnings: [],
    rows: [
      {
        table: "t",
        key: "k",
        op: "update",
        before: { m: { a: 1, b: 2 } },
        after: { m: { b: 2, a: 1 } },
        changed: ["m"],
      },
    ],
  });
  expect(screen.getByText("No visible difference (order only)")).toBeTruthy();
});

test("more than 50 changes are capped with a remainder note", () => {
  const before = { m: Object.fromEntries(Array.from({ length: 55 }, (_, i) => [`k${i}`, 0])) };
  const after = { m: Object.fromEntries(Array.from({ length: 55 }, (_, i) => [`k${i}`, 1])) };
  renderCard({
    ...proposal,
    warnings: [],
    rows: [{ table: "t", key: "k", op: "update", before, after, changed: ["m"] }],
  });
  expect(screen.getByRole("list", { name: "m" }).querySelectorAll("li")).toHaveLength(51);
  expect(screen.getByText("5 more")).toBeTruthy();
});

test("a long text field shows a line diff instead of side-by-side values", () => {
  const body = (s: string) => `## Purpose\nintro\n- ${s}\n- other\n`;
  renderCard({
    ...proposal,
    rows: [
      {
        table: "docs",
        key: "health",
        op: "update",
        before: { body: body("Influenza vaccination.") },
        after: { body: body("Flu vaccination.") },
        changed: ["body"],
      },
    ],
  });
  expect(screen.queryByTestId("field-diff")).toBeNull();
  const diff = screen.getByRole("group", { name: "body" });
  expect(diff.querySelectorAll("mark")).toHaveLength(2);
  expect(diff.textContent).toContain("Influenza");
  expect(diff.textContent).toContain("Flu");
});
