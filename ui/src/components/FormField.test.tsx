import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { type ReactNode, useState } from "react";
import { expect, test, vi } from "vitest";
import { setMobile } from "@/test/media";
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

test("an MDX preview shows its JSX and expressions as written and renders the Markdown inside", async () => {
  const body = 'import { Note } from "./Note";\n\n<Note kind="tip">\n  Read *this*.\n</Note>\n\nHi {props.name}.';
  const { container } = render(
    wrap(<FormField path={["body"]} value={body} type="TEXT" format="markdown" mdx onChange={() => {}} />),
  );
  expect((await screen.findByText('<Note kind="tip">')).className).toBe("mdx-tag");
  expect(screen.getByText("this").tagName).toBe("EM");
  expect(screen.getByText("{props.name}").className).toBe("mdx-expr");
  expect(container.querySelector(".mdx-esm summary")?.textContent).toBe('import { Note } from "./Note";');
});

test("MDX that does not parse falls back to plain Markdown and says so", async () => {
  render(
    wrap(
      <FormField path={["body"]} value={"# Title\n\n<Note"} type="TEXT" format="markdown" mdx onChange={() => {}} />,
    ),
  );
  expect(await screen.findByRole("heading", { name: "Title" })).toBeTruthy();
  expect(screen.getByText(/does not parse/)).toBeTruthy();
});

test("a fenced code block in the preview is highlighted", async () => {
  const { container } = render(
    wrap(
      <FormField
        path={["body"]}
        value={"```ts\nconst x = 1;\n```"}
        type="TEXT"
        format="markdown"
        onChange={() => {}}
      />,
    ),
  );
  await screen.findByText("const");
  expect(container.querySelector("pre .tok-keyword")?.textContent).toBe("const");
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

test("a date field edits with a date input and emits the date as text; clearing it emits null", () => {
  const onChange = vi.fn();
  render(wrap(<FormField path={["due"]} value="2026-10-06" type="TEXT" format="date" onChange={onChange} />));
  const input = screen.getByLabelText("due") as HTMLInputElement;
  expect(input.type).toBe("date");
  fireEvent.change(input, { target: { value: "2026-10-31" } });
  expect(onChange).toHaveBeenLastCalledWith("2026-10-31");
  fireEvent.change(input, { target: { value: "" } });
  expect(onChange).toHaveBeenLastCalledWith(null);
});

test("a datetime field keeps the value's offset and shows it next to the picker", () => {
  const onChange = vi.fn();
  render(
    wrap(
      <FormField path={["at"]} value="2026-10-06T09:00:30+09:00" type="TEXT" format="datetime" onChange={onChange} />,
    ),
  );
  const input = screen.getByLabelText("at") as HTMLInputElement;
  expect(input.type).toBe("datetime-local");
  // seconds that are not :00, since an input normalizes 09:00:00 to 09:00
  expect(input.value).toBe("2026-10-06T09:00:30");
  expect(screen.getByText("+09:00")).toBeTruthy();
  fireEvent.change(input, { target: { value: "2026-10-06T12:30:15" } });
  expect(onChange).toHaveBeenLastCalledWith("2026-10-06T12:30:15+09:00");
});

test("a datetime the picker cannot show is edited as text, and the toggle switches back when it can", () => {
  function Harness() {
    const [value, setValue] = useState<unknown>("tomorrow");
    return <FormField path={["at"]} value={value} type="TEXT" format="datetime" onChange={setValue} />;
  }
  render(wrap(<Harness />));
  const text = screen.getByLabelText("at") as HTMLInputElement;
  expect(text.type).toBe("text");
  expect(screen.getByText("not a datetime")).toBeTruthy();
  fireEvent.change(text, { target: { value: "2026-10-06T09:00Z" } });
  fireEvent.click(screen.getByRole("button", { name: "at as picker" }));
  expect((screen.getByLabelText("at") as HTMLInputElement).type).toBe("datetime-local");
  fireEvent.click(screen.getByRole("button", { name: "at as text" }));
  expect((screen.getByLabelText("at") as HTMLInputElement).value).toBe("2026-10-06T09:00Z");
});

test("a number out of bounds is marked and explained, and still emitted", () => {
  const onChange = vi.fn();
  render(wrap(<FormField path={["priority"]} value={7} type="INTEGER" max={5} onChange={onChange} />));
  expect(screen.getByText("above max 5")).toBeTruthy();
  fireEvent.change(screen.getByLabelText("priority"), { target: { value: "9" } });
  expect(onChange).toHaveBeenLastCalledWith(9);
});

test("the date picker gets the bounds as min and max", () => {
  render(
    wrap(
      <FormField
        path={["due"]}
        value={null}
        type="TEXT"
        format="date"
        min="2026-01-01"
        max="2026-12-31"
        onChange={() => {}}
      />,
    ),
  );
  const input = screen.getByLabelText("due") as HTMLInputElement;
  expect(input.min).toBe("2026-01-01");
  expect(input.max).toBe("2026-12-31");
});

test("a datetime keeps its spelling when the picker is emptied before the new value is typed", () => {
  let latest: unknown;
  function Harness() {
    const [value, setValue] = useState<unknown>("2026-10-06 09:00:30Z");
    latest = value;
    return <FormField path={["at"]} value={value} type="TEXT" format="datetime" onChange={setValue} />;
  }
  render(wrap(<Harness />));
  const picker = screen.getByLabelText("at") as HTMLInputElement;
  fireEvent.change(picker, { target: { value: "" } });
  expect(latest).toBe(null);
  fireEvent.change(screen.getByLabelText("at"), { target: { value: "2026-10-06T12:30:15" } });
  expect(latest).toBe("2026-10-06 12:30:15Z");
});

test("a value outside its bounds gets the warning border", () => {
  render(wrap(<FormField path={["priority"]} value={7} type="INTEGER" max={5} onChange={() => {}} />));
  expect(screen.getByLabelText("priority").className).toContain("border-warn");
});

test("a value inside its bounds keeps the normal border", () => {
  render(wrap(<FormField path={["priority"]} value={3} type="INTEGER" max={5} onChange={() => {}} />));
  expect(screen.getByLabelText("priority").className).not.toContain("border-warn");
});

test("a datetime picker gets the bounds in the value's offset", () => {
  render(
    wrap(
      <FormField
        path={["at"]}
        value="2026-10-06T09:00:00+09:00"
        type="TEXT"
        format="datetime"
        min="2026-01-01"
        max="2026-12-31T23:59:59Z"
        onChange={() => {}}
      />,
    ),
  );
  const input = screen.getByLabelText("at") as HTMLInputElement;
  expect(input.min).toBe("2026-01-01T09:00");
  expect(input.max).toBe("2027-01-01T08:59:59");
});

test("emptying a date field's text emits null and brings the picker toggle back", () => {
  let latest: unknown;
  function Harness() {
    const [value, setValue] = useState<unknown>("soon");
    latest = value;
    return <FormField path={["due"]} value={value} type="TEXT" format="date" onChange={setValue} />;
  }
  render(wrap(<Harness />));
  expect(screen.queryByRole("button", { name: "due as picker" })).toBeNull();
  fireEvent.change(screen.getByLabelText("due"), { target: { value: "" } });
  expect(latest).toBe(null);
  expect(screen.getByRole("button", { name: "due as picker" })).toBeTruthy();
});

test("a chip can be added with a button on a phone", () => {
  act(() => setMobile(true));
  const onChange = vi.fn();
  render(wrap(<FormField path={["tags"]} value={["a"]} type="JSON" onChange={onChange} />));
  fireEvent.change(screen.getByLabelText("tags"), { target: { value: "b" } });
  fireEvent.click(screen.getByRole("button", { name: "add to tags" }));
  expect(onChange).toHaveBeenCalledWith(["a", "b"]);
});
