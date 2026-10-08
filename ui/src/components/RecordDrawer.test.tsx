import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { expect, test, vi } from "vitest";
import { api } from "@/lib/api";
import type { TableMeta } from "@/lib/types";
import { setMobile } from "@/test/media";
import { RecordDrawer } from "./RecordDrawer";

const dispatch = vi.hoisted(() => vi.fn());
const navigate = vi.hoisted(() => vi.fn());
vi.mock("@tanstack/react-router", () => ({ useNavigate: () => navigate }));
vi.mock("@/lib/providers", () => ({
  useEvents: () => ({ connected: true }),
  useReflect: () => undefined,
  useReflectDispatch: () => dispatch,
}));
vi.mock("@/lib/api", async (orig) => ({
  ...(await orig<typeof import("@/lib/api")>()),
  api: { record: vi.fn(), update: vi.fn(), remove: vi.fn(), rows: vi.fn(), history: vi.fn(), historyDiff: vi.fn() },
}));

const table: TableMeta = {
  name: "tasks",
  mode: "files",
  path: "tasks",
  key: "id",
  columns: { id: "TEXT", title: "TEXT", prio: "INTEGER" },
  formats: {},
  values: {},
  required: [],
  min: {},
  max: {},
  references: [],
  count: 1,
  inDb: true,
  group: null,
  split: null,
};

test("after a save the form keeps the saved values until the refetch arrives", async () => {
  vi.mocked(api.record)
    .mockResolvedValueOnce({ row: { id: "a", title: "old", prio: null }, file: "tasks/a.yaml", yaml: "" })
    .mockReturnValue(new Promise(() => {}));
  vi.mocked(api.update).mockResolvedValue({ ok: true });
  render(
    <QueryClientProvider client={new QueryClient()}>
      <RecordDrawer table={table} recordKey="a" />
    </QueryClientProvider>,
  );
  const title = (await screen.findByLabelText("title")) as HTMLInputElement;
  fireEvent.change(title, { target: { value: "new" } });
  fireEvent.click(screen.getByRole("button", { name: /Save/ }));
  await waitFor(() => expect(api.update).toHaveBeenCalled());
  await waitFor(() => expect(screen.getByRole("button", { name: /Save/ }).hasAttribute("disabled")).toBe(true));
  expect(screen.getByLabelText("title")).toBe(title);
  expect(title.value).toBe("new");
});

test("a markdown column opens on its rendered preview", async () => {
  vi.mocked(api.record).mockResolvedValue({ row: { id: "a", title: "# Hi", prio: null }, file: "f", yaml: "" });
  render(
    <QueryClientProvider client={new QueryClient()}>
      <RecordDrawer table={{ ...table, formats: { title: "markdown" } }} recordKey="a" />
    </QueryClientProvider>,
  );
  expect(await screen.findByRole("heading", { name: "Hi" })).toBeTruthy();
  expect(screen.getByText("markdown")).toBeTruthy();
});

test("an unset INTEGER shows the 0 it was given", async () => {
  vi.mocked(api.record).mockResolvedValue({ row: { id: "a", title: "x", prio: null }, file: "f", yaml: "" });
  render(
    <QueryClientProvider client={new QueryClient()}>
      <RecordDrawer table={table} recordKey="a" />
    </QueryClientProvider>,
  );
  fireEvent.click(await screen.findByLabelText("prio"));
  expect((screen.getByLabelText("prio") as HTMLInputElement).value).toBe("0");
});

test("write-back tracking starts before the save responds, and a failed save cancels it", async () => {
  dispatch.mockClear();
  vi.mocked(api.record).mockResolvedValue({ row: { id: "a", title: "old", prio: null }, file: "f", yaml: "" });
  let fail: (e: Error) => void = () => {};
  vi.mocked(api.update).mockReturnValue(new Promise((_r, reject) => (fail = reject)));
  render(
    <QueryClientProvider client={new QueryClient()}>
      <RecordDrawer table={table} recordKey="a" />
    </QueryClientProvider>,
  );
  fireEvent.change(await screen.findByLabelText("title"), { target: { value: "new" } });
  fireEvent.click(screen.getByRole("button", { name: /Save/ }));
  // the watcher may write the file before the response, so the entry must already exist
  await waitFor(() => expect(dispatch).toHaveBeenCalledWith(expect.objectContaining({ type: "saved", key: "a" })));
  fail(new Error("boom"));
  await waitFor(() => expect(dispatch).toHaveBeenCalledWith({ type: "cancelled", table: "tasks", key: "a" }));
});

async function openDrawer() {
  navigate.mockClear();
  vi.mocked(api.record).mockResolvedValue({
    row: { id: "a", title: "old", prio: null },
    file: "tasks/a.yaml",
    yaml: "",
  });
  render(
    <QueryClientProvider client={new QueryClient()}>
      <main>
        <div role="row" data-key="b">
          <span>row b</span>
        </div>
        <p>outside</p>
      </main>
      <RecordDrawer table={table} recordKey="a" />
    </QueryClientProvider>,
  );
  return (await screen.findByLabelText("title")) as HTMLInputElement;
}

const closedKey = () => {
  const search = navigate.mock.calls.at(-1)?.[0]?.search as ((p: object) => { key?: string }) | undefined;
  return search?.({ key: "a", sort: "title:asc" });
};

test("Escape closes the drawer", async () => {
  await openDrawer();
  fireEvent.keyDown(document, { key: "Escape" });
  expect(navigate).toHaveBeenCalledTimes(1);
  expect(closedKey()).toEqual({ key: undefined, sort: "title:asc" });
});

test("a click outside closes the drawer; inside it or on another row does not", async () => {
  const title = await openDrawer();
  fireEvent.click(title);
  fireEvent.click(screen.getByText("row b"));
  expect(navigate).not.toHaveBeenCalled();
  fireEvent.click(screen.getByText("outside"));
  expect(navigate).toHaveBeenCalledTimes(1);
  expect(closedKey()).toEqual({ key: undefined, sort: "title:asc" });
});

test("a click on something in the drawer that removes itself does not close it", async () => {
  const title = await openDrawer();
  const add = document.createElement("button");
  add.addEventListener("click", () => add.remove());
  title.closest("fieldset")?.append(add);
  fireEvent.click(add);
  expect(navigate).not.toHaveBeenCalled();
});

test("unsaved edits keep the drawer open on Escape or a click outside", async () => {
  const title = await openDrawer();
  fireEvent.change(title, { target: { value: "new" } });
  fireEvent.keyDown(document, { key: "Escape" });
  fireEvent.click(screen.getByText("outside"));
  expect(navigate).not.toHaveBeenCalled();
});

const drawer = () => screen.getByRole("complementary", { name: "record" });
const handle = () => screen.getByRole("separator", { name: "Resize record panel" });
const drag = (from: number, to: number) => {
  fireEvent.pointerDown(handle(), { clientX: from, button: 0 });
  fireEvent.pointerMove(document, { clientX: to });
  fireEvent.pointerUp(document, { clientX: to });
};

test("a drag captures the pointer and marks the body until it ends", async () => {
  localStorage.clear();
  await openDrawer();
  const el = handle();
  const captured: number[] = [];
  el.setPointerCapture = (id: number) => void captured.push(id);
  fireEvent.pointerDown(el, { clientX: 600, button: 0, pointerId: 7 });
  expect(captured).toEqual([7]);
  expect(document.body.hasAttribute("data-resizing")).toBe(true);
  fireEvent.pointerMove(el, { clientX: 550 });
  expect(drawer().style.width).toBe("410px");
  fireEvent.pointerUp(el, { clientX: 550 });
  expect(document.body.hasAttribute("data-resizing")).toBe(false);
});

test("a lost capture or a cancel ends the drag and stops following the pointer", async () => {
  for (const end of ["lostPointerCapture", "pointerCancel"] as const) {
    localStorage.clear();
    await openDrawer();
    fireEvent.pointerDown(handle(), { clientX: 600, button: 0 });
    fireEvent[end](handle());
    expect(document.body.hasAttribute("data-resizing")).toBe(false);
    fireEvent.pointerMove(document, { clientX: 100 });
    expect(drawer().style.width).toBe("360px");
    cleanup();
  }
});

test("dragging the left edge widens the panel and the width is remembered", async () => {
  localStorage.clear();
  await openDrawer();
  expect(drawer().style.width).toBe("360px");
  drag(600, 500);
  expect(drawer().style.width).toBe("460px");
  expect(localStorage.getItem("yamlite-drawer-width")).toBe("460");
  cleanup();
  await openDrawer();
  expect(drawer().style.width).toBe("460px");
});

test("the width stays between 320px and 70% of the window", async () => {
  localStorage.clear();
  window.innerWidth = 1000;
  await openDrawer();
  drag(600, 900);
  expect(drawer().style.width).toBe("320px");
  drag(600, -400);
  expect(drawer().style.width).toBe("700px");
});

test("a remembered width out of range or unreadable falls back into range", async () => {
  window.innerWidth = 1000;
  localStorage.setItem("yamlite-drawer-width", "5000");
  await openDrawer();
  expect(drawer().style.width).toBe("700px");
  cleanup();
  localStorage.setItem("yamlite-drawer-width", "wide");
  await openDrawer();
  expect(drawer().style.width).toBe("360px");
});

test("double-clicking the edge restores the default width", async () => {
  localStorage.clear();
  await openDrawer();
  drag(600, 500);
  fireEvent.doubleClick(handle());
  expect(drawer().style.width).toBe("360px");
  expect(localStorage.getItem("yamlite-drawer-width")).toBeNull();
});

test("arrow keys on the edge resize the panel", async () => {
  localStorage.clear();
  window.innerWidth = 1000;
  await openDrawer();
  fireEvent.keyDown(handle(), { key: "ArrowLeft" });
  expect(drawer().style.width).toBe("376px");
  fireEvent.keyDown(handle(), { key: "ArrowRight" });
  fireEvent.keyDown(handle(), { key: "ArrowRight" });
  expect(drawer().style.width).toBe("344px");
  expect(handle().getAttribute("aria-valuenow")).toBe("344");
});

test("the click that ends a drag outside the panel does not close it", async () => {
  localStorage.clear();
  await openDrawer();
  drag(600, 300);
  // a browser fires click on the common ancestor of where the drag started and ended
  fireEvent.click(document.body);
  expect(navigate).not.toHaveBeenCalled();
  await new Promise((r) => setTimeout(r, 0));
  fireEvent.click(screen.getByText("outside"));
  expect(navigate).toHaveBeenCalledTimes(1);
});

test("a required column is starred, and warns while it is empty", async () => {
  vi.mocked(api.record).mockResolvedValue({ row: { id: "a", title: null, prio: 1 }, file: "f", yaml: "" });
  const view = render(
    <QueryClientProvider client={new QueryClient()}>
      <RecordDrawer table={{ ...table, required: ["title"] }} recordKey="a" />
    </QueryClientProvider>,
  );
  const name = (await screen.findByText("title")).closest("span") as HTMLElement;
  expect(name.querySelector('[aria-label="required"]')?.textContent).toBe(" *");
  expect(name.className).toContain("text-warn");
  expect(screen.getByText("prio").closest("span")?.querySelector('[aria-label="required"]')).toBeNull();
  view.unmount();

  vi.mocked(api.record).mockResolvedValue({ row: { id: "a", title: "x", prio: 1 }, file: "f", yaml: "" });
  render(
    <QueryClientProvider client={new QueryClient()}>
      <RecordDrawer table={{ ...table, required: ["title"] }} recordKey="a" />
    </QueryClientProvider>,
  );
  const filled = (await screen.findByText("title")).closest("span") as HTMLElement;
  expect(filled.className).not.toContain("text-warn");
});

test("after saving a restored version, a new edit is no longer labelled as restored", async () => {
  vi.mocked(api.record)
    .mockResolvedValueOnce({ row: { id: "a", title: "new", prio: null }, file: "tasks/a.yaml", yaml: "" })
    .mockReturnValue(new Promise(() => {}));
  vi.mocked(api.update).mockResolvedValue({ ok: true });
  vi.mocked(api.history).mockResolvedValue({
    state: "ok",
    next: null,
    entries: [
      {
        kind: "commit",
        sha: "7be0d44".padEnd(40, "0"),
        head: false,
        subject: "old title",
        author: "alice",
        date: "2026-10-01T00:00:00Z",
        path: "tasks/a.yaml",
        changes: [{ path: "title", from: null, to: "old" }],
        record: { title: "old" },
      },
    ],
  });
  render(
    <QueryClientProvider client={new QueryClient()}>
      <RecordDrawer table={table} recordKey="a" />
    </QueryClientProvider>,
  );
  fireEvent.mouseDown(await screen.findByRole("tab", { name: /History/ }));
  fireEvent.click(await screen.findByRole("button", { name: /old title/ }));
  fireEvent.click(screen.getByRole("button", { name: "Restore this version" }));
  fireEvent.click(await screen.findByRole("button", { name: /Save/ }));
  await waitFor(() => expect(screen.getByRole("button", { name: /Save/ }).hasAttribute("disabled")).toBe(true));
  fireEvent.change(screen.getByLabelText("title"), { target: { value: "typed" } });
  expect(screen.getByText("1 change · saving writes it to the file")).toBeTruthy();
});

test("restoring a version fills the form, marks it unsaved, and Discard undoes it", async () => {
  vi.mocked(api.record).mockResolvedValue({ row: { id: "a", title: "new", prio: 3 }, file: "tasks/a.yaml", yaml: "" });
  vi.mocked(api.history).mockResolvedValue({
    state: "ok",
    next: null,
    entries: [
      {
        kind: "commit",
        sha: "7be0d44".padEnd(40, "0"),
        head: false,
        subject: "old title",
        author: "alice",
        date: "2026-10-01T00:00:00Z",
        path: "tasks/a.yaml",
        changes: [{ path: "title", from: null, to: "old" }],
        record: { title: "old" },
      },
    ],
  });
  render(
    <QueryClientProvider client={new QueryClient()}>
      <RecordDrawer table={table} recordKey="a" />
    </QueryClientProvider>,
  );
  fireEvent.mouseDown(await screen.findByRole("tab", { name: /History/ }));
  fireEvent.click(await screen.findByRole("button", { name: /old title/ }));
  fireEvent.click(screen.getByRole("button", { name: "Restore this version" }));
  expect(((await screen.findByLabelText("title")) as HTMLInputElement).value).toBe("old");
  expect(screen.getByText("Restored the values from 7be0d44 · 2 fields unsaved")).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: "Discard" }));
  expect(((await screen.findByLabelText("title")) as HTMLInputElement).value).toBe("new");
});

test("fills the screen on a phone, without a resize handle, and the back button closes it", async () => {
  act(() => setMobile(true));
  vi.mocked(api.record).mockResolvedValue({ row: { id: "a", title: "x", prio: 1 }, file: "f", yaml: "" });
  const onClose = vi.fn();
  render(
    <QueryClientProvider client={new QueryClient()}>
      <RecordDrawer table={table} recordKey="a" onClose={onClose} />
    </QueryClientProvider>,
  );
  await screen.findByLabelText("title");
  const panel = screen.getByRole("complementary", { name: "record" });
  expect(panel.className).toContain("max-md:fixed");
  expect(panel.style.width).toBe("");
  expect(screen.queryByRole("separator")).toBeNull();
  expect(screen.getByRole("button", { name: "Save" }).textContent).not.toContain("⌘");
  fireEvent.click(screen.getByRole("button", { name: "close" }));
  expect(onClose).toHaveBeenCalled();
});

test("keeps the draft when the screen crosses the breakpoint", async () => {
  vi.mocked(api.record).mockResolvedValue({ row: { id: "a", title: "x", prio: 1 }, file: "f", yaml: "" });
  render(
    <QueryClientProvider client={new QueryClient()}>
      <RecordDrawer table={table} recordKey="a" />
    </QueryClientProvider>,
  );
  fireEvent.change(await screen.findByLabelText("title"), { target: { value: "edited" } });
  act(() => setMobile(true));
  expect((screen.getByLabelText("title") as HTMLInputElement).value).toBe("edited");
  expect(screen.getByRole("complementary", { name: "record" }).style.width).toBe("");
});

test("on a phone the panel shrinks to the space the keyboard leaves", async () => {
  act(() => setMobile(true));
  const listeners = new Set<() => void>();
  const viewport = {
    height: 800,
    addEventListener: (_: string, l: () => void) => listeners.add(l),
    removeEventListener: (_: string, l: () => void) => listeners.delete(l),
  };
  Object.defineProperty(window, "visualViewport", { configurable: true, value: viewport });
  vi.mocked(api.record).mockResolvedValue({ row: { id: "a", title: "x", prio: 1 }, file: "f", yaml: "" });
  render(
    <QueryClientProvider client={new QueryClient()}>
      <RecordDrawer table={table} recordKey="a" />
    </QueryClientProvider>,
  );
  await screen.findByLabelText("title");
  const panel = screen.getByRole("complementary", { name: "record" });
  expect(panel.style.height).toBe("800px");
  act(() => {
    viewport.height = 420;
    for (const l of listeners) l();
  });
  expect(panel.style.height).toBe("420px");
  Object.defineProperty(window, "visualViewport", { configurable: true, value: undefined });
});

test("on a phone only a text field scrolls into view when focused", async () => {
  act(() => setMobile(true));
  const scroll = vi.fn();
  Element.prototype.scrollIntoView = scroll;
  vi.mocked(api.record).mockResolvedValue({ row: { id: "a", title: "x", prio: 1 }, file: "f", yaml: "" });
  render(
    <QueryClientProvider client={new QueryClient()}>
      <RecordDrawer table={table} recordKey="a" />
    </QueryClientProvider>,
  );
  fireEvent.focus(await screen.findByLabelText("title"));
  expect(scroll).toHaveBeenCalledTimes(1);
  // anything else in the form, such as a switch or a chip's add button, leaves the scroll alone
  const other = document.createElement("button");
  screen.getByLabelText("title").closest("fieldset")?.append(other);
  fireEvent.focus(other);
  expect(scroll).toHaveBeenCalledTimes(1);
});
