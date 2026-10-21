import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { toast } from "sonner";
import { afterEach, expect, test, vi } from "vitest";
import { api } from "@/lib/api";
import { gitApi, type GitState } from "@/lib/git";
import { ReviewDialog } from "./ReviewDialog";

vi.mock("@/lib/git", async (orig) => {
  const real = await orig<typeof import("@/lib/git")>();
  return { ...real, gitApi: { ...real.gitApi, review: vi.fn(), diff: vi.fn(), revert: vi.fn() } };
});
vi.mock("@/lib/api", async (orig) => ({
  ...(await orig<typeof import("@/lib/api")>()),
  api: { create: vi.fn(), update: vi.fn(), remove: vi.fn() },
}));
vi.mock("@/lib/providers", () => ({
  useMeta: () => ({
    data: {
      tables: [
        { name: "people", mode: "list" },
        { name: "tasks", mode: "files" },
      ],
    },
  }),
}));
vi.mock("sonner", () => ({ toast: Object.assign(vi.fn(), { success: vi.fn(), error: vi.fn() }) }));
afterEach(() => vi.clearAllMocks());

const git: GitState = {
  branch: "main",
  defaultBranch: "main",
  upstream: "origin/main",
  namesBranch: true,
  changes: [
    {
      path: "people.yaml",
      status: "modified",
      table: "people",
      records: [
        { key: "1", kind: "modified", fields: ["name"] },
        { key: "2", kind: "added", fields: [] },
      ],
    },
    {
      path: "tasks/a.yaml",
      status: "modified",
      table: "tasks",
      records: [{ key: "a", kind: "modified", fields: ["title"] }],
    },
    { path: "tasks/b.yaml", status: "deleted", table: "tasks", records: [{ key: "b", kind: "deleted", fields: [] }] },
    { path: "yamlite.yaml", status: "modified", table: null, records: null },
    { path: ".pages/new.html", status: "added", table: null, records: null },
  ],
};

function renderDialog(state: GitState = git, onOpenChange = () => {}) {
  return render(
    <QueryClientProvider client={new QueryClient()}>
      <ReviewDialog git={state} open onOpenChange={onOpenChange} />
    </QueryClientProvider>,
  );
}

test("lists records under their files, with other files last", () => {
  renderDialog();
  expect(screen.getAllByRole("checkbox").map((c) => c.getAttribute("aria-label"))).toEqual([
    "Include people.yaml",
    "Include tasks/a.yaml",
    "Include tasks/b.yaml",
    "Include yamlite.yaml",
    "Include .pages/new.html",
  ]);
  expect(screen.getByRole("button", { name: "Put 1 back as committed" })).toBeTruthy();
  expect(screen.getByRole("button", { name: "Delete 2; it was never committed" })).toBeTruthy();
  expect(screen.getByRole("button", { name: "Put a back as committed" })).toBeTruthy();
  expect(screen.getByRole("button", { name: "Put b back as committed" })).toBeTruthy();
  expect(screen.getByRole("button", { name: "Put yamlite.yaml back as committed" })).toBeTruthy();
  expect(screen.getByRole("button", { name: "Delete .pages/new.html; it was never committed" })).toBeTruthy();
  expect(screen.getByText("Other files")).toBeTruthy();
});

test("expanding a file shows its fields as committed and now", async () => {
  vi.mocked(gitApi.diff).mockResolvedValue({
    records: [{ key: "a", kind: "modified", fields: [{ field: "title", from: "Buy milk", to: "Buy oat milk" }] }],
  });
  renderDialog();
  fireEvent.click(screen.getByRole("button", { name: "Show the changes in tasks/a.yaml" }));
  const diff = await screen.findByTestId("field-diff");
  expect(gitApi.diff).toHaveBeenCalledWith("tasks/a.yaml");
  expect(within(diff).getByText("Committed")).toBeTruthy();
  expect(diff.textContent).toContain("Buy milk");
  expect(diff.textContent).toContain("Buy oat milk");
  expect([...diff.querySelectorAll("mark")].map((m) => m.textContent)).toEqual(["oat "]);
});

test("a record goes back as committed, and the toast's undo writes the previous values back", async () => {
  vi.mocked(gitApi.revert).mockResolvedValue({
    reverted: [{ table: "tasks", key: "a", before: { title: "A2", note: "x" }, after: { title: "A", note: null } }],
    files: [],
  });
  renderDialog();
  fireEvent.click(screen.getByRole("button", { name: "Put a back as committed" }));
  await waitFor(() => expect(toast.success).toHaveBeenCalled());
  expect(gitApi.revert).toHaveBeenCalledWith({ records: [{ table: "tasks", key: "a" }], files: [] });
  const [message, opts] = vi.mocked(toast.success).mock.calls[0]!;
  expect(message).toBe("Put 1 change back as committed");
  (opts as unknown as { action: { onClick: () => void } }).action.onClick();
  await waitFor(() =>
    expect(api.update).toHaveBeenCalledWith("tasks", "a", { title: "A2", note: "x" }, { title: "A", note: null }),
  );
});

test("an added record is deleted only after a second click", async () => {
  vi.mocked(gitApi.revert).mockResolvedValue({
    reverted: [{ table: "people", key: "2", before: { name: "Bob" }, after: null }],
    files: [],
  });
  renderDialog();
  fireEvent.click(screen.getByRole("button", { name: "Delete 2; it was never committed" }));
  expect(gitApi.revert).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole("button", { name: "Delete" }));
  await waitFor(() =>
    expect(gitApi.revert).toHaveBeenCalledWith({ records: [{ table: "people", key: "2", delete: true }], files: [] }),
  );
});

test("a file that holds no records goes back only after a second click, with no undo", async () => {
  vi.mocked(gitApi.revert).mockResolvedValue({ reverted: [], files: ["yamlite.yaml"] });
  renderDialog();
  fireEvent.click(screen.getByRole("button", { name: "Put yamlite.yaml back as committed" }));
  expect(gitApi.revert).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole("button", { name: "Put back" }));
  await waitFor(() => expect(toast.success).toHaveBeenCalled());
  expect(gitApi.revert).toHaveBeenCalledWith({ records: [], files: ["yamlite.yaml"] });
  expect(vi.mocked(toast.success).mock.calls[0]).toEqual(["Put 1 change back as committed", {}]);
});

test("a file's second click is asked for again once the focus moves away", () => {
  renderDialog();
  fireEvent.click(screen.getByRole("button", { name: "Put yamlite.yaml back as committed" }));
  fireEvent.blur(screen.getByRole("button", { name: "Put back" }));
  expect(screen.queryByRole("button", { name: "Put back" })).toBeNull();
  expect(screen.getByRole("button", { name: "Put yamlite.yaml back as committed" })).toBeTruthy();
});

test("an added file that holds no records is deleted only after a second click", async () => {
  vi.mocked(gitApi.revert).mockResolvedValue({ reverted: [], files: [".pages/new.html"] });
  renderDialog();
  fireEvent.click(screen.getByRole("button", { name: "Delete .pages/new.html; it was never committed" }));
  expect(gitApi.revert).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole("button", { name: "Delete" }));
  await waitFor(() => expect(gitApi.revert).toHaveBeenCalledWith({ records: [], files: [".pages/new.html"] }));
});

test("the bulk button puts back changed and deleted records of the checked files, never added ones", async () => {
  vi.mocked(gitApi.revert).mockResolvedValue({ reverted: [], files: [] });
  renderDialog();
  fireEvent.click(screen.getByRole("checkbox", { name: "Include tasks/a.yaml" }));
  fireEvent.click(screen.getByRole("checkbox", { name: "Include yamlite.yaml" }));
  fireEvent.click(screen.getByRole("button", { name: "Put back 2 changes" }));
  await waitFor(() =>
    expect(gitApi.revert).toHaveBeenCalledWith({
      records: [
        { table: "people", key: "1" },
        { table: "tasks", key: "b" },
      ],
      files: [],
    }),
  );
});

test("the bulk button counts changed files too, and asks once more before putting them back", async () => {
  vi.mocked(gitApi.revert).mockResolvedValue({ reverted: [], files: ["yamlite.yaml"] });
  renderDialog();
  fireEvent.click(screen.getByRole("checkbox", { name: "Include tasks/a.yaml" }));
  fireEvent.click(screen.getByRole("button", { name: "Put back 3 changes" }));
  expect(gitApi.revert).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole("button", { name: "Put back 3 changes (no undo)" }));
  await waitFor(() =>
    expect(gitApi.revert).toHaveBeenCalledWith({
      records: [
        { table: "people", key: "1" },
        { table: "tasks", key: "b" },
      ],
      files: ["yamlite.yaml"],
    }),
  );
});

test("the bulk button asks again when the changes it would put back change", () => {
  const client = new QueryClient();
  const dialog = (state: GitState) => (
    <QueryClientProvider client={client}>
      <ReviewDialog git={state} open onOpenChange={() => {}} />
    </QueryClientProvider>
  );
  const view = render(dialog(git));
  fireEvent.click(screen.getByRole("button", { name: "Put back 4 changes" }));
  expect(screen.getByRole("button", { name: "Put back 4 changes (no undo)" })).toBeTruthy();
  const more: GitState = {
    ...git,
    changes: [...git.changes, { path: "notes.txt", status: "modified", table: null, records: null }],
  };
  view.rerender(dialog(more));
  fireEvent.click(screen.getByRole("button", { name: "Put back 5 changes" }));
  expect(gitApi.revert).not.toHaveBeenCalled();
});

test("sends the title, the description and only the checked files, then links the PR", async () => {
  vi.mocked(gitApi.review).mockResolvedValue({
    branch: "yamlite/review-20261008-070509",
    steps: ["create_branch", "commit", "push", "open_pr"],
    results: [],
    url: "https://github.com/acme/notes/pull/7",
    created: true,
  });
  renderDialog();
  const send = screen.getByRole("button", { name: "Send" }) as HTMLButtonElement;
  expect(send.disabled).toBe(true);
  fireEvent.change(screen.getByRole("textbox", { name: "Title" }), { target: { value: " Update tasks " } });
  fireEvent.change(screen.getByRole("textbox", { name: "Description (optional)" }), { target: { value: "why" } });
  fireEvent.click(screen.getByRole("checkbox", { name: "Include yamlite.yaml" }));
  fireEvent.click(send);
  await waitFor(() => expect(screen.getByRole("link", { name: "Open the review" })).toBeTruthy());
  expect(gitApi.review).toHaveBeenCalledWith({
    title: "Update tasks",
    body: "why",
    paths: ["people.yaml", "tasks/a.yaml", "tasks/b.yaml", ".pages/new.html"],
  });
  expect(screen.getByText("Sent for review.")).toBeTruthy();
});

test("a failed step shows git's message", async () => {
  vi.mocked(gitApi.review).mockResolvedValue({
    branch: "work",
    steps: ["commit", "push", "open_pr"],
    results: [],
    url: null,
    created: false,
    error: "origin is not a GitHub repository",
  });
  renderDialog();
  fireEvent.change(screen.getByRole("textbox", { name: "Title" }), { target: { value: "x" } });
  fireEvent.click(screen.getByRole("button", { name: "Send" }));
  expect((await screen.findByRole("alert")).textContent).toBe("origin is not a GitHub repository");
  expect(screen.queryByRole("button", { name: "Send" })).toBeNull();
});

test("the dialog closes once nothing is left to send", () => {
  const onOpenChange = vi.fn();
  renderDialog({ ...git, changes: [] }, onOpenChange);
  expect(onOpenChange).toHaveBeenCalledWith(false);
});

test("a branch name is sent from the default branch, and the field is hidden elsewhere", async () => {
  vi.mocked(gitApi.review).mockResolvedValue({
    branch: "fix/tasks",
    steps: [],
    results: [],
    url: null,
    created: false,
  });
  const { unmount } = renderDialog();
  fireEvent.change(screen.getByRole("textbox", { name: /^Branch name/ }), { target: { value: " fix/tasks " } });
  fireEvent.change(screen.getByRole("textbox", { name: "Title" }), { target: { value: "Update" } });
  fireEvent.click(screen.getByRole("button", { name: "Send" }));
  await waitFor(() =>
    expect(gitApi.review).toHaveBeenCalledWith(expect.objectContaining({ title: "Update", branch: "fix/tasks" })),
  );
  unmount();
  renderDialog({ ...git, branch: "work" });
  expect(screen.queryByRole("textbox", { name: /^Branch name/ })).toBeNull();
});

test("a host that names the branch itself is not asked for one", () => {
  renderDialog({ ...git, namesBranch: false });
  expect(screen.getByRole("textbox", { name: "Title" })).toBeTruthy();
  expect(screen.queryByRole("textbox", { name: /^Branch name/ })).toBeNull();
});
