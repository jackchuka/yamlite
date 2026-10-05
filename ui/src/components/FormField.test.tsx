import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { type ReactNode, useState } from "react";
import { expect, test, vi } from "vitest";
import { FormField } from "./FormField";

vi.mock("@tanstack/react-router", () => ({
  Link: ({
    params,
    search,
    children,
    ...rest
  }: {
    params: { table: string };
    search: unknown;
    children: ReactNode;
  }) => (
    <a href="#" data-table={params.table} data-search={JSON.stringify(search)} {...rest}>
      {children}
    </a>
  ),
}));
vi.mock("@/lib/providers", () => ({ useMeta: () => ({ data: { tables: [{ name: "people", key: "id" }] } }) }));
vi.mock("@/lib/api", async (orig) => ({
  ...(await orig<typeof import("@/lib/api")>()),
  api: { rows: vi.fn(() => new Promise(() => {})) },
}));

const wrap = (ui: React.ReactNode) => <QueryClientProvider client={new QueryClient()}>{ui}</QueryClientProvider>;

test("an INTEGER input ignores anything but digits and emits numbers", () => {
  const onChange = vi.fn();
  render(wrap(<FormField path={["n"]} value={3} type="INTEGER" onChange={onChange} />));
  const input = screen.getByLabelText("n");
  for (const bad of ["1.5", "1e21", "Infinity", "0x10"]) fireEvent.change(input, { target: { value: bad } });
  expect(onChange).not.toHaveBeenCalled();
  fireEvent.change(input, { target: { value: "12" } });
  expect(onChange).toHaveBeenLastCalledWith(12);
  fireEvent.change(input, { target: { value: "9007199254740993" } });
  expect(onChange).toHaveBeenLastCalledWith("9007199254740993");
});

test("a REAL input rejects non-finite input", () => {
  const onChange = vi.fn();
  render(wrap(<FormField path={["r"]} value={1} type="REAL" onChange={onChange} />));
  const input = screen.getByLabelText("r");
  fireEvent.change(input, { target: { value: "Infinity" } });
  expect(onChange).not.toHaveBeenCalled();
  fireEvent.change(input, { target: { value: "1.5" } });
  expect(onChange).toHaveBeenLastCalledWith(1.5);
});

test("typing past 80 characters keeps the same element", () => {
  function Host() {
    const [v, setV] = useState("x".repeat(79));
    return <FormField path={["t"]} value={v} type="TEXT" onChange={(n) => setV(n as string)} />;
  }
  render(wrap(<Host />));
  const before = screen.getByLabelText("t");
  fireEvent.change(before, { target: { value: "x".repeat(85) } });
  const after = screen.getByLabelText("t") as HTMLInputElement;
  expect(after).toBe(before);
  expect(after.value).toBe("x".repeat(85));
});

test("a JSON field shows a value that changed from outside", () => {
  const { rerender } = render(wrap(<FormField path={["j"]} value={[1, 2]} type="JSON" onChange={() => {}} />));
  expect(screen.getByLabelText("j").textContent).toContain("1");
  rerender(wrap(<FormField path={["j"]} value={[7, 8]} type="JSON" onChange={() => {}} />));
  expect(screen.getByLabelText("j").textContent).toContain("7");
  expect(screen.getByLabelText("j").textContent).not.toContain("1");
});

test("a markdown field opens on the rendered preview and edits the source", async () => {
  render(
    wrap(<FormField path={["body"]} value={"# Title\n\n- one"} type="TEXT" format="markdown" onChange={() => {}} />),
  );
  expect(await screen.findByRole("heading", { name: "Title" })).toBeTruthy();
  expect(screen.getByRole("listitem").textContent).toBe("one");
  fireEvent.mouseDown(screen.getByRole("tab", { name: "Edit" }));
  expect(screen.getByLabelText("body").textContent).toContain("# Title");
});

test("an unset markdown field opens on the editor, since there is nothing to preview", async () => {
  function Unset() {
    const [v, setV] = useState<unknown>(null);
    return <FormField path={["body"]} value={v} type="TEXT" format="markdown" onChange={setV} />;
  }
  render(wrap(<Unset />));
  fireEvent.click(screen.getByLabelText("body"));
  expect((await screen.findByRole("tab", { name: "Edit" })).getAttribute("data-state")).toBe("active");
});

function UnsetJson({ onChange }: { onChange?: (v: unknown) => void }) {
  const [v, setV] = useState<unknown>(null);
  return (
    <FormField
      path={["j"]}
      value={v}
      type="JSON"
      onChange={(n) => {
        setV(n);
        onChange?.(n);
      }}
    />
  );
}

test("an unset JSON field offers map, list and JSON", () => {
  render(wrap(<UnsetJson />));
  for (const k of ["map", "list", "JSON"]) expect(screen.getByLabelText(`j as ${k}`)).toBeTruthy();
});

test("choosing list on an unset JSON field emits [] and shows a chip input", () => {
  const onChange = vi.fn();
  render(wrap(<UnsetJson onChange={onChange} />));
  fireEvent.click(screen.getByLabelText("j as list"));
  expect(onChange).toHaveBeenLastCalledWith([]);
  expect(screen.getByLabelText("j").tagName).toBe("INPUT");
});

test("choosing map on an unset JSON field emits {}", () => {
  const onChange = vi.fn();
  render(wrap(<UnsetJson onChange={onChange} />));
  fireEvent.click(screen.getByLabelText("j as map"));
  expect(onChange).toHaveBeenLastCalledWith({});
  expect(screen.getByText("+ key")).toBeTruthy();
});

test("choosing JSON keeps a JSON editor even though the value is []", () => {
  render(wrap(<UnsetJson />));
  fireEvent.click(screen.getByLabelText("j as JSON"));
  const el = screen.getByLabelText("j");
  expect(el.tagName).not.toBe("INPUT");
  expect(el.textContent).toContain("[]");
});

test("a reference field links to the record it names once it has a value", () => {
  const reference = { column: "owner", table: "people" };
  const { rerender } = render(
    wrap(<FormField path={["owner"]} value={null} reference={reference} onChange={() => {}} />),
  );
  expect(screen.queryByRole("link")).toBeNull();
  rerender(wrap(<FormField path={["owner"]} value="ann" reference={reference} onChange={() => {}} />));
  expect(screen.getByRole("link", { name: "open people ann" }).dataset).toMatchObject({
    table: "people",
    search: JSON.stringify({ key: "ann" }),
  });
});

test("a markdown preview opens links in a new tab, so following one keeps the app open", async () => {
  render(
    wrap(
      <FormField
        path={["body"]}
        value={"[docs](https://example.com)"}
        type="TEXT"
        format="markdown"
        onChange={() => {}}
      />,
    ),
  );
  const link = await screen.findByRole("link", { name: "docs" });
  expect(link.getAttribute("target")).toBe("_blank");
  expect(link.getAttribute("rel")).toBe("noopener noreferrer");
});

test("a markdown editor follows a theme change made while it is open", async () => {
  document.documentElement.dataset.theme = "light";
  render(wrap(<FormField path={["body"]} value={""} type="TEXT" format="markdown" onChange={() => {}} />));
  const editor = await screen.findByLabelText("body");
  const root = editor.closest(".cm-editor") ?? editor;
  const before = root.className;
  await act(async () => {
    document.documentElement.dataset.theme = "dark";
  });
  await waitFor(() => expect((editor.closest(".cm-editor") ?? editor).className).not.toBe(before));
  document.documentElement.dataset.theme = "light";
});

test("a column with values is a select that emits the listed value", () => {
  const onChange = vi.fn();
  render(wrap(<FormField path={["status"]} value="todo" type="TEXT" allowed={["todo", "done"]} onChange={onChange} />));
  const select = screen.getByLabelText("status") as HTMLSelectElement;
  expect([...select.options].map((o) => o.textContent)).toEqual(["—", "todo", "done"]);
  fireEvent.change(select, { target: { value: "done" } });
  expect(onChange).toHaveBeenLastCalledWith("done");
  fireEvent.change(select, { target: { value: "" } });
  expect(onChange).toHaveBeenLastCalledWith(null);
});

test("a value outside the list stays selected and is marked", () => {
  const onChange = vi.fn();
  render(wrap(<FormField path={["status"]} value="doen" type="TEXT" allowed={["todo", "done"]} onChange={onChange} />));
  const select = screen.getByLabelText("status") as HTMLSelectElement;
  expect(select.value).toBe("doen");
  expect(select.getAttribute("aria-invalid")).toBe("true");
  expect([...select.options].map((o) => o.textContent)).toContain("doen (not in values)");
  expect(onChange).not.toHaveBeenCalled();
});

test("numbers and booleans come back typed", () => {
  const onChange = vi.fn();
  const { unmount } = render(
    wrap(<FormField path={["rank"]} value={1} type="INTEGER" allowed={[1, 2]} onChange={onChange} />),
  );
  fireEvent.change(screen.getByLabelText("rank"), { target: { value: "2" } });
  expect(onChange).toHaveBeenLastCalledWith(2);
  unmount();
  render(wrap(<FormField path={["done"]} value={false} type="BOOLEAN" allowed={[true, false]} onChange={onChange} />));
  const select = screen.getByLabelText("done") as HTMLSelectElement;
  expect(select.value).toBe("0");
  fireEvent.change(select, { target: { value: "1" } });
  expect(onChange).toHaveBeenLastCalledWith(true);
});

test("an unset value with values shows the select, not the unset button", () => {
  render(wrap(<FormField path={["status"]} value={null} type="TEXT" allowed={["todo"]} onChange={() => {}} />));
  const el = screen.getByLabelText("status") as HTMLSelectElement;
  expect(el.tagName).toBe("SELECT");
  expect(el.value).toBe("");
});

test('a list holding 1 and "1" renders both options without a key collision', () => {
  const error = vi.spyOn(console, "error").mockImplementation(() => {});
  render(wrap(<FormField path={["n"]} value={1} type="TEXT" allowed={[1, "1"]} onChange={() => {}} />));
  expect(screen.getAllByRole("option").map((o) => o.textContent)).toEqual(["—", "1", "1"]);
  expect(error).not.toHaveBeenCalled();
  error.mockRestore();
});

test("a JSON column ignores values", () => {
  render(wrap(<FormField path={["tags"]} value={["a"]} type="JSON" allowed={["a"]} onChange={() => {}} />));
  expect(screen.queryByRole("combobox")).toBeNull();
});
