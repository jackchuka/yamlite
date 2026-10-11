import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, within } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, expect, test, vi } from "vitest";
import { api } from "@/lib/api";
import type { SearchHit } from "@/lib/types";
import { SearchView } from "./SearchView";

const navigate = vi.fn();
let params: { q?: string } = {};
vi.mock("@tanstack/react-router", () => ({
  useNavigate: () => navigate,
  Link: ({
    to,
    params: p,
    search,
    children,
    className,
  }: {
    to: string;
    params?: { table: string };
    search?: Record<string, string>;
    children: ReactNode;
    className?: string;
  }) => (
    <a
      className={className}
      href={`${to.replace("$table", p?.table ?? "")}${search ? `?${new URLSearchParams(search)}` : ""}`}
    >
      {children}
    </a>
  ),
}));
vi.mock("@/routes", () => ({ searchRoute: { useSearch: () => params } }));
vi.mock("@/lib/api", async (orig) => ({
  ...(await orig<typeof import("@/lib/api")>()),
  api: { search: vi.fn() },
}));
afterEach(() => {
  params = {};
  navigate.mockReset();
  vi.mocked(api.search).mockReset();
});

const show = () =>
  render(
    <QueryClientProvider client={new QueryClient()}>
      <SearchView />
    </QueryClientProvider>,
  );
const hit = (over: Partial<SearchHit>): SearchHit => ({
  table: "tasks",
  key: "k",
  label: null,
  column: "title",
  value: "",
  rank: 3,
  total: 1,
  ...over,
});

test("a short query shows the hint and does not search", () => {
  params = { q: "a" };
  show();
  expect(screen.getByText("Type at least 2 characters.")).toBeTruthy();
  expect(api.search).not.toHaveBeenCalled();
});

test("hits are grouped by table, best table first, linking to the record", async () => {
  params = { q: "alpha" };
  vi.mocked(api.search).mockResolvedValue({
    hits: [
      hit({ table: "tasks", key: "t1", value: "Write about alpha", total: 2 }),
      hit({ table: "projects", key: "alpha", column: "id", value: "alpha", rank: 0, total: 1 }),
      hit({ table: "tasks", key: "alphabet", column: "id", value: "alphabet", rank: 1, total: 2 }),
    ],
  });
  show();
  const sections = await screen.findAllByRole("region");
  expect(sections.map((s) => s.getAttribute("aria-label"))).toEqual(["projects", "tasks"]);
  const tasks = within(sections[1] as HTMLElement);
  expect(tasks.getByText("2 matches")).toBeTruthy();
  expect(tasks.getAllByRole("link").map((a) => a.getAttribute("href"))).toEqual([
    "/t/tasks?key=alphabet",
    "/t/tasks?key=t1",
  ]);
  // the key alphabet and the snippet of t1
  expect(tasks.getAllByText("alpha", { selector: "mark" })).toHaveLength(2);
});

test("a table with more matches than shown links to its filtered table view", async () => {
  params = { q: "alpha" };
  vi.mocked(api.search).mockResolvedValue({
    hits: Array.from({ length: 20 }, (_, i) => hit({ key: `k${i}`, value: "alpha", total: 57 })),
  });
  show();
  const more = await screen.findByRole("link", { name: "Show all 57 in this table" });
  expect(more.getAttribute("href")).toBe("/t/tasks?q=alpha");
  expect(api.search).toHaveBeenCalledWith("alpha", 20);
});

test("no hits says so", async () => {
  params = { q: "zzz" };
  vi.mocked(api.search).mockResolvedValue({ hits: [] });
  show();
  expect(await screen.findByText("No records match.")).toBeTruthy();
});

test("typing updates q in the URL", async () => {
  params = { q: "alpha" };
  vi.mocked(api.search).mockResolvedValue({ hits: [] });
  show();
  fireEvent.change(screen.getByRole("searchbox"), { target: { value: "beta" } });
  await vi.waitFor(() =>
    expect(navigate).toHaveBeenCalledWith({ to: "/search", search: { q: "beta" }, replace: true }),
  );
});

test("a space typed mid-query survives the URL update", async () => {
  params = { q: "foo" };
  vi.mocked(api.search).mockResolvedValue({ hits: [] });
  const view = show();
  const box = screen.getByRole("searchbox") as HTMLInputElement;
  fireEvent.change(box, { target: { value: "foo bar " } });
  await vi.waitFor(() =>
    expect(navigate).toHaveBeenCalledWith({ to: "/search", search: { q: "foo bar" }, replace: true }),
  );
  params = { q: "foo bar" };
  view.rerender(
    <QueryClientProvider client={new QueryClient()}>
      <SearchView />
    </QueryClientProvider>,
  );
  expect(box.value).toBe("foo bar ");
});

test("a hit leads with the record's label, then its key; the matched column shows only when it adds something", async () => {
  params = { q: "design" };
  vi.mocked(api.search).mockResolvedValue({
    hits: [
      hit({
        key: "design-review-1",
        label: "Design review round 1",
        column: "id",
        value: "design-review-1",
        rank: 1,
        total: 2,
      }),
      hit({
        key: "onboarding",
        label: "Write onboarding copy",
        column: "note",
        value: "align with the design tokens",
        total: 2,
      }),
    ],
  });
  show();
  const [first, second] = await screen.findAllByRole("link", { name: /design-review-1|onboarding/ });
  expect(first?.textContent).toBe("Design review round 1design-review-1");
  expect(second?.textContent).toContain("note");
  expect(second?.textContent).toContain("align with the design tokens");
});

test("a hit without a label leads with its key", async () => {
  params = { q: "alpha" };
  vi.mocked(api.search).mockResolvedValue({ hits: [hit({ key: "alpha", column: "id", value: "alpha", rank: 0 })] });
  show();
  expect((await screen.findByRole("link", { name: /alpha/ })).textContent).toBe("alpha");
});

test("a summary counts every match and table", async () => {
  params = { q: "alpha" };
  vi.mocked(api.search).mockResolvedValue({
    hits: [
      hit({ table: "projects", key: "alpha", value: "alpha", rank: 0, total: 1 }),
      hit({ table: "tasks", key: "t1", value: "about alpha", total: 9 }),
    ],
  });
  show();
  expect(await screen.findByText("10 matches · 2 tables")).toBeTruthy();
});
