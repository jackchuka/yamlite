import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, expect, test, vi } from "vitest";
import { api, ApiError } from "@/lib/api";
import type { Rules } from "@/lib/types";
import { setMobile } from "@/test/media";
import { RuleEditor } from "./RuleEditor";

vi.mock("@/lib/providers", () => ({
  useMeta: () => ({
    data: {
      tables: [
        { name: "tasks", key: "id" },
        { name: "people", key: "id" },
      ],
    },
  }),
}));

const none = { required: [], values: {}, formats: {}, min: {}, max: {}, references: {} };
const props = {
  target: { table: "tasks", path: [] },
  columns: { id: "TEXT", title: "TEXT", status: "TEXT", priority: "INTEGER", done: "BOOLEAN" } as const,
  fixed: ["id"],
  initial: { ...none, values: { status: ["todo", "done"] } } as Rules,
  base: "h1",
  views: [] as { name: string; path: string[] }[],
  onOpenView: vi.fn(),
  onDone: vi.fn(),
};
const wrap = (p: Parameters<typeof RuleEditor>[0]) => (
  <QueryClientProvider client={new QueryClient()}>
    <RuleEditor {...p} />
  </QueryClientProvider>
);
const ui = (p: Parameters<typeof RuleEditor>[0] = props) => render(wrap(p));
const saveButton = () => screen.getByRole("button", { name: "Save to yamlite.yaml" }) as HTMLButtonElement;

beforeEach(() => {
  vi.restoreAllMocks();
  vi.spyOn(api, "previewRules").mockResolvedValue({ added: [], removed: [], changed: false });
});

test("the list shows each column's rules in short", () => {
  ui();
  expect(screen.getByRole("button", { name: /status/ }).textContent).toContain("values 2");
});

test("fields follow the column's type", () => {
  ui();
  fireEvent.click(screen.getByRole("button", { name: /priority/ }));
  expect(screen.getByLabelText("Min")).toBeTruthy();
  expect(screen.queryByText("Allowed values")).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: /^done/ }));
  expect(screen.queryByLabelText("Min")).toBeNull();
});

test("a change is previewed and its warnings shown under the field", async () => {
  vi.mocked(api.previewRules).mockImplementation(async (_t, rules) =>
    rules.required.includes("title")
      ? { added: ["title missing (b)"], removed: [], changed: true }
      : { added: [], removed: [], changed: false },
  );
  ui();
  fireEvent.click(screen.getByRole("button", { name: /title/ }));
  fireEvent.click(screen.getByLabelText("Required"));
  await waitFor(() => expect(screen.getByText("Saving adds 1 warning")).toBeTruthy());
  expect(screen.getAllByText("title missing (b)").length).toBeGreaterThan(0);
  expect(api.previewRules).toHaveBeenLastCalledWith(props.target, { ...props.initial, required: ["title"] }, "h1", {});
});

test("409 keeps the draft", async () => {
  vi.mocked(api.previewRules).mockResolvedValue({ added: [], removed: [], changed: true });
  vi.spyOn(api, "saveRules").mockRejectedValue(new ApiError(409, "changed", { error: "changed", current: "h2" }));
  ui();
  fireEvent.click(screen.getByRole("button", { name: /title/ }));
  fireEvent.click(screen.getByLabelText("Required"));
  await waitFor(() =>
    expect((screen.getByRole("button", { name: "Save to yamlite.yaml" }) as HTMLButtonElement).disabled).toBe(false),
  );
  fireEvent.click(screen.getByRole("button", { name: "Save to yamlite.yaml" }));
  await waitFor(() => expect(screen.getByText(/changed elsewhere/)).toBeTruthy());
  expect((screen.getByLabelText("Required") as HTMLInputElement).checked).toBe(true);
  expect(props.onDone).not.toHaveBeenCalled();
});

test("fixed columns are listed but not editable, and views open the same editor", () => {
  const onOpenView = vi.fn();
  ui({ ...props, views: [{ name: "tasks__steps", path: ["steps"] }], onOpenView });
  expect((screen.getByRole("button", { name: /^id/ }) as HTMLButtonElement).disabled).toBe(true);
  fireEvent.click(screen.getByRole("button", { name: "tasks__steps ▸" }));
  expect(onOpenView).toHaveBeenCalledWith("tasks__steps");
});

test("on a phone the list and the form stack", () => {
  setMobile(true);
  ui();
  expect(screen.queryByLabelText("Required")).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: /title/ }));
  expect(screen.getByLabelText("Required")).toBeTruthy();
  expect(screen.queryByRole("button", { name: /status/ })).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: /Columns/ }));
  expect(screen.getByRole("button", { name: /status/ })).toBeTruthy();
});

test("the base is the one editing started from, even when the schema refetches", async () => {
  vi.mocked(api.previewRules).mockResolvedValue({ added: [], removed: [], changed: true });
  const saveRules = vi.spyOn(api, "saveRules").mockResolvedValue({ added: [], removed: [], changed: true, base: "h3" });
  const { rerender } = ui();
  fireEvent.click(screen.getByRole("button", { name: /title/ }));
  fireEvent.click(screen.getByLabelText("Required"));
  rerender(wrap({ ...props, base: "h2" }));
  await waitFor(() => expect(saveButton().disabled).toBe(false));
  fireEvent.click(saveButton());
  await waitFor(() => expect(saveRules).toHaveBeenCalled());
  expect(saveRules).toHaveBeenCalledWith(props.target, { ...props.initial, required: ["title"] }, "h1", {});
  expect(api.previewRules).not.toHaveBeenCalledWith(expect.anything(), expect.anything(), "h2");
});

test("Save waits for the preview of the latest draft", async () => {
  vi.mocked(api.previewRules).mockResolvedValue({ added: [], removed: [], changed: true });
  ui();
  fireEvent.click(screen.getByRole("button", { name: /title/ }));
  fireEvent.click(screen.getByLabelText("Required"));
  await waitFor(() => expect(saveButton().disabled).toBe(false));
  fireEvent.click(screen.getByLabelText("Required"));
  expect(saveButton().disabled).toBe(true);
});

test("choosing another referenced table clears the referenced column", async () => {
  ui({ ...props, initial: { ...none, references: { title: "people.name" } } });
  fireEvent.click(screen.getByRole("button", { name: /title/ }));
  expect((screen.getByLabelText("Referenced column") as HTMLInputElement).value).toBe("name");
  fireEvent.change(screen.getByLabelText("References"), { target: { value: "tasks" } });
  expect((screen.getByLabelText("Referenced column") as HTMLInputElement).value).toBe("");
  await waitFor(() =>
    expect(api.previewRules).toHaveBeenLastCalledWith(
      props.target,
      { ...none, references: { title: "tasks" } },
      "h1",
      {},
    ),
  );
});

test("each warning shows under the field it is about", async () => {
  const added = [
    "status missing (b)",
    'status "wip" not in values (b)',
    'status "x" not found in people.id (b)',
    'references.status: column "nope" not found in people',
    'status "x" is not a date (b)',
  ];
  vi.mocked(api.previewRules).mockResolvedValue({ added, removed: [], changed: true });
  ui();
  fireEvent.click(screen.getByRole("button", { name: /status/ }));
  await waitFor(() => expect(screen.getAllByText("status missing (b)").length).toBeGreaterThan(0));
  const fieldOf = (e: Element) => e.closest('section:not([data-slot="section-card"])');
  const inForm = (text: string) => screen.getAllByText(text).find((e) => fieldOf(e) || !e.closest("footer"));
  const field = (text: string) => {
    const e = inForm(text);
    return (e && fieldOf(e)?.querySelector("h4")?.textContent) ?? null;
  };
  expect(field("status missing (b)")).toBe("Required");
  expect(field('status "wip" not in values (b)')).toBe("Allowed values");
  expect(field('status "x" not found in people.id (b)')).toBe("References");
  expect(field('references.status: column "nope" not found in people')).toBe("References");
  expect(field('status "x" is not a date (b)')).toBeNull();
  expect(inForm('status "x" is not a date (b)')).toBeTruthy();
});

test("a 409 without a current base is shown as an error, not a conflict", async () => {
  vi.mocked(api.previewRules).mockResolvedValue({ added: [], removed: [], changed: true });
  vi.spyOn(api, "saveRules").mockRejectedValue(
    new ApiError(409, "git steps are running; try again when they finish", { error: "busy" }),
  );
  ui();
  fireEvent.click(screen.getByRole("button", { name: /title/ }));
  fireEvent.click(screen.getByLabelText("Required"));
  await waitFor(() => expect(saveButton().disabled).toBe(false));
  fireEvent.click(saveButton());
  await waitFor(() => expect(screen.getByText(/git steps are running/)).toBeTruthy());
  expect(screen.queryByText(/changed elsewhere/)).toBeNull();
});

const statusIndex = { name: "yamlite_tasks_1", definition: "(status)", columns: ["status"], unique: false, inDb: true };
const exprIndex = {
  name: "yamlite_tasks_2",
  definition: "(lower(title))",
  expr: "lower(title)",
  unique: false,
  inDb: true,
};
const schemaProps = {
  ...props,
  columns: { ...props.columns, steps: "JSON", tags: "JSON" } as const,
  indexes: [statusIndex, exprIndex],
  views: [
    { name: "tasks__steps", path: ["steps"] },
    { name: "tasks__steps__subs", path: ["steps", "subs"] },
  ],
};
const kept = [
  { columns: ["status"], unique: false },
  { expr: "lower(title)", unique: false },
];

test("an index is added from columns in order, previewed and saved", async () => {
  vi.mocked(api.previewRules).mockImplementation(async (_t, _r, _b, edit) =>
    edit?.indexes
      ? { added: [], removed: [], changed: true, indexes: { added: ["unique (title, priority)"], removed: [] } }
      : { added: [], removed: [], changed: false },
  );
  const saveRules = vi.spyOn(api, "saveRules").mockResolvedValue({ added: [], removed: [], changed: true, base: "h2" });
  ui(schemaProps);
  fireEvent.click(screen.getByRole("button", { name: /Add index/ }));
  fireEvent.change(screen.getByLabelText("Column"), { target: { value: "title" } });
  fireEvent.click(screen.getByRole("button", { name: "Add column" }));
  fireEvent.change(screen.getByLabelText("Column"), { target: { value: "priority" } });
  fireEvent.click(screen.getByRole("button", { name: "Add column" }));
  fireEvent.click(screen.getByLabelText("Unique"));
  fireEvent.click(screen.getByRole("button", { name: "Add index" }));
  const indexes = [...kept, { columns: ["title", "priority"], unique: true }];
  await waitFor(() =>
    expect(api.previewRules).toHaveBeenLastCalledWith(schemaProps.target, schemaProps.initial, "h1", { indexes }),
  );
  expect(await screen.findByText("+ index unique (title, priority)")).toBeTruthy();
  await waitFor(() => expect(saveButton().disabled).toBe(false));
  fireEvent.click(saveButton());
  await waitFor(() =>
    expect(saveRules).toHaveBeenCalledWith(schemaProps.target, schemaProps.initial, "h1", { indexes }),
  );
});

test("× removes an index, an expression index included", async () => {
  ui(schemaProps);
  expect(screen.getByText("(lower(title))")).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: "Remove (status)" }));
  await waitFor(() =>
    expect(api.previewRules).toHaveBeenLastCalledWith(schemaProps.target, schemaProps.initial, "h1", {
      indexes: [{ expr: "lower(title)", unique: false }],
    }),
  );
  fireEvent.click(screen.getByRole("button", { name: "Remove (lower(title))" }));
  await waitFor(() =>
    expect(api.previewRules).toHaveBeenLastCalledWith(schemaProps.target, schemaProps.initial, "h1", {
      indexes: [],
    }),
  );
});

test("a removed index is listed in the footer", async () => {
  vi.mocked(api.previewRules).mockResolvedValue({
    added: [],
    removed: [],
    changed: true,
    indexes: { added: [], removed: ["(status)"] },
  });
  ui(schemaProps);
  fireEvent.click(screen.getByRole("button", { name: "Remove (status)" }));
  expect(await screen.findByText("− index (status)")).toBeTruthy();
});

test("a view is added from the JSON columns not yet expanded", async () => {
  ui(schemaProps);
  fireEvent.click(screen.getByRole("button", { name: "+ Add view" }));
  const select = screen.getByLabelText("JSON column") as HTMLSelectElement;
  expect([...select.options].map((o) => o.value).filter(Boolean)).toEqual(["tags"]);
  fireEvent.change(select, { target: { value: "tags" } });
  fireEvent.click(screen.getByRole("button", { name: "Add view" }));
  await waitFor(() =>
    expect(api.previewRules).toHaveBeenLastCalledWith(schemaProps.target, schemaProps.initial, "h1", {
      views: ["steps", "tags"],
    }),
  );
  expect(screen.getByText("No JSON columns to expand")).toBeTruthy();
});

test("removing a view asks first, since its rules go with it", async () => {
  const confirm = vi.spyOn(window, "confirm").mockReturnValue(false);
  ui(schemaProps);
  fireEvent.click(screen.getByRole("button", { name: "Remove tasks__steps" }));
  expect(confirm).toHaveBeenCalledWith("Removing tasks__steps also removes its rules.");
  expect(screen.getByRole("button", { name: "Remove tasks__steps" })).toBeTruthy();
  confirm.mockReturnValue(true);
  fireEvent.click(screen.getByRole("button", { name: "Remove tasks__steps" }));
  await waitFor(() =>
    expect(api.previewRules).toHaveBeenLastCalledWith(schemaProps.target, schemaProps.initial, "h1", { views: [] }),
  );
});

test("a view's editor has no indexes and edits the view's own expand", async () => {
  ui({
    ...props,
    target: { table: "tasks", path: ["steps"] },
    viewName: "tasks__steps",
    columns: { tasks_id: "TEXT", idx: "INTEGER", title: "TEXT", subs: "JSON", links: "JSON" },
    fixed: ["tasks_id", "idx"],
    views: [{ name: "tasks__steps__subs", path: ["steps", "subs"] }],
  });
  expect(screen.queryByText("Indexes")).toBeNull();
  expect(screen.queryByRole("button", { name: /Add index/ })).toBeNull();
  expect(screen.getByRole("button", { name: "Remove tasks__steps__subs" })).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: "+ Add view" }));
  fireEvent.change(screen.getByLabelText("JSON column"), { target: { value: "links" } });
  fireEvent.click(screen.getByRole("button", { name: "Add view" }));
  await waitFor(() =>
    expect(api.previewRules).toHaveBeenLastCalledWith({ table: "tasks", path: ["steps"] }, props.initial, "h1", {
      views: ["subs", "links"],
    }),
  );
});

test("Save leaves indexes and views out when they are unchanged", async () => {
  vi.mocked(api.previewRules).mockResolvedValue({ added: [], removed: [], changed: true });
  const saveRules = vi.spyOn(api, "saveRules").mockResolvedValue({ added: [], removed: [], changed: true, base: "h2" });
  ui(schemaProps);
  fireEvent.click(screen.getByRole("button", { name: "Remove (status)" }));
  fireEvent.click(screen.getByRole("button", { name: /^title/ }));
  fireEvent.click(screen.getByLabelText("Required"));
  fireEvent.click(screen.getByRole("button", { name: /Add index/ }));
  fireEvent.change(screen.getByLabelText("Column"), { target: { value: "status" } });
  fireEvent.click(screen.getByRole("button", { name: "Add column" }));
  fireEvent.click(screen.getByRole("button", { name: "Add index" }));
  await waitFor(() => expect(saveButton().disabled).toBe(false));
  fireEvent.click(saveButton());
  await waitFor(() => expect(saveRules).toHaveBeenCalled());
  expect(saveRules).toHaveBeenCalledWith(schemaProps.target, { ...schemaProps.initial, required: ["title"] }, "h1", {});
});

test("opening a view with a changed draft asks first, and declining keeps the draft", () => {
  const onOpenView = vi.fn();
  const confirm = vi.spyOn(window, "confirm").mockReturnValue(false);
  ui({ ...schemaProps, onOpenView });
  fireEvent.click(screen.getByRole("button", { name: /^title/ }));
  fireEvent.click(screen.getByLabelText("Required"));
  fireEvent.click(screen.getByRole("button", { name: "tasks__steps ▸" }));
  expect(confirm).toHaveBeenCalledWith("Discard your draft and load the latest rules?");
  expect(onOpenView).not.toHaveBeenCalled();
  expect((screen.getByLabelText("Required") as HTMLInputElement).checked).toBe(true);
  confirm.mockReturnValue(true);
  fireEvent.click(screen.getByRole("button", { name: "tasks__steps ▸" }));
  expect(onOpenView).toHaveBeenCalledWith("tasks__steps");
});

test("opening a view with an unchanged draft does not ask", () => {
  const onOpenView = vi.fn();
  const confirm = vi.spyOn(window, "confirm");
  ui({ ...schemaProps, onOpenView });
  fireEvent.click(screen.getByRole("button", { name: "tasks__steps ▸" }));
  expect(confirm).not.toHaveBeenCalled();
  expect(onOpenView).toHaveBeenCalledWith("tasks__steps");
});

test("a view removed in the draft, and the views under it, lose their link", () => {
  vi.spyOn(window, "confirm").mockReturnValue(true);
  ui(schemaProps);
  expect(screen.getByRole("button", { name: "tasks__steps__subs ▸" })).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: "Remove tasks__steps" }));
  expect(screen.queryByRole("button", { name: "tasks__steps ▸" })).toBeNull();
  expect(screen.queryByRole("button", { name: "tasks__steps__subs ▸" })).toBeNull();
});

const lastRules = () => vi.mocked(api.previewRules).mock.lastCall?.[1];

test("Enter or a comma in the values field adds a value, once", async () => {
  ui();
  fireEvent.click(screen.getByRole("button", { name: /status/ }));
  const input = screen.getByPlaceholderText("Type a value and press Enter");
  expect(screen.queryByRole("button", { name: "Add" })).toBeNull();
  fireEvent.change(input, { target: { value: "wip" } });
  fireEvent.keyDown(input, { key: "Enter" });
  fireEvent.change(input, { target: { value: "late" } });
  fireEvent.keyDown(input, { key: "," });
  fireEvent.change(input, { target: { value: "todo" } });
  fireEvent.keyDown(input, { key: "Enter" });
  expect((input as HTMLInputElement).value).toBe("");
  await waitFor(() => expect(lastRules()?.values).toEqual({ status: ["todo", "done", "wip", "late"] }));
});

test("Backspace on an empty values field removes the last value", async () => {
  ui();
  fireEvent.click(screen.getByRole("button", { name: /status/ }));
  const input = screen.getByPlaceholderText("Type a value and press Enter");
  fireEvent.keyDown(input, { key: "Backspace" });
  await waitFor(() => expect(lastRules()?.values).toEqual({ status: ["todo"] }));
  expect(screen.getByRole("button", { name: "Remove todo" })).toBeTruthy();
  fireEvent.keyDown(input, { key: "Backspace" });
  await waitFor(() => expect(lastRules()?.values).toEqual({}));
});

test("numbers typed into the values of an INTEGER column are kept as numbers", async () => {
  ui();
  fireEvent.click(screen.getByRole("button", { name: /priority/ }));
  const input = screen.getByPlaceholderText("Type a value and press Enter");
  fireEvent.change(input, { target: { value: "x" } });
  fireEvent.keyDown(input, { key: "Enter" });
  expect((input as HTMLInputElement).value).toBe("x");
  fireEvent.change(input, { target: { value: "3" } });
  fireEvent.keyDown(input, { key: "Enter" });
  await waitFor(() => expect(lastRules()?.values).toEqual({ status: ["todo", "done"], priority: [3] }));
});

test("a column whose rules changed is marked in the list", () => {
  ui();
  expect(screen.getByRole("button", { name: /^title/ }).textContent).not.toContain("changed");
  fireEvent.click(screen.getByRole("button", { name: /^title/ }));
  fireEvent.click(screen.getByLabelText("Required"));
  expect(screen.getByRole("button", { name: /^title/ }).textContent).toContain("required · changed");
  expect(screen.getByRole("button", { name: /status/ }).textContent).not.toContain("changed");
  fireEvent.click(screen.getByLabelText("Required"));
  expect(screen.getByRole("button", { name: /^title/ }).textContent).not.toContain("changed");
});

test("the referenced column sits next to the table, without a separator", () => {
  ui({ ...props, initial: { ...none, references: { title: "people.name" } } });
  expect(screen.getByPlaceholderText("column (optional)")).toBe(screen.getByLabelText("Referenced column"));
  expect(screen.queryByText(".")).toBeNull();
});

test("on a phone the back button sits in the form's heading", () => {
  setMobile(true);
  ui();
  fireEvent.click(screen.getByRole("button", { name: /title/ }));
  const heading = screen.getByRole("heading", { name: "title" });
  expect(heading.parentElement?.contains(screen.getByRole("button", { name: /Columns/ }))).toBe(true);
});

test("a JSON column's format is list or map, and either hides allowed values", async () => {
  ui({ ...props, columns: { ...props.columns, tags: "JSON" }, initial: { ...none, values: { tags: ["a"] } } });
  fireEvent.click(screen.getByRole("button", { name: /tags/ }));
  const select = screen.getByLabelText("Format") as HTMLSelectElement;
  expect([...select.options].map((o) => o.value)).toEqual(["", "list", "map"]);
  expect(screen.queryByText("Allowed values")).toBeTruthy();
  fireEvent.change(select, { target: { value: "list" } });
  expect(screen.queryByText("Allowed values")).toBeNull();
  expect(screen.getByRole("button", { name: /tags/ }).textContent).toContain("list");
  await waitFor(() =>
    expect(api.previewRules).toHaveBeenLastCalledWith(props.target, { ...none, formats: { tags: "list" } }, "h1", {}),
  );
  fireEvent.click(screen.getByRole("button", { name: /title/ }));
  expect([...(screen.getByLabelText("Format") as HTMLSelectElement).options].map((o) => o.value)).toEqual([
    "",
    "date",
    "datetime",
    "markdown",
  ]);
});
