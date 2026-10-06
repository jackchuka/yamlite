import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { api } from "@/lib/api";
import { enterStatic } from "@/lib/mode";
import type { Snapshot } from "@/lib/types";
import { PageView } from "./PageView";

vi.mock("@tanstack/react-router", () => ({ useNavigate: () => vi.fn() }));
vi.mock("@/lib/api", async (orig) => ({
  ...(await orig<typeof import("@/lib/api")>()),
  api: { meta: vi.fn(), pageHtml: vi.fn(), conflicts: vi.fn(), record: vi.fn() },
}));

const snapshot: Snapshot = {
  version: 1,
  generatedAt: "2026-10-04T00:00:00.000Z",
  meta: {
    root: "data",
    db: "data/db.sqlite",
    configFile: "yamlite.yaml",
    configError: null,
    tables: [],
    views: [],
    pages: [
      {
        name: "board",
        title: "Board",
        path: ".pages/b.html",
        access: { tasks: "write" },
        sql: true,
        network: ["https://cdn.example.com"],
      },
    ],
  },
  schemas: {},
  warnings: {},
};

beforeEach(() => {
  enterStatic(snapshot);
  vi.mocked(api.meta).mockResolvedValue(snapshot.meta);
  vi.mocked(api.pageHtml).mockResolvedValue("<p>hello page</p>");
});
afterEach(() => enterStatic(null));

async function show(name: string) {
  const { Providers } = await import("@/lib/providers");
  return render(
    <Providers>
      <PageView name={name} />
    </Providers>,
  );
}

test("the page runs in a sandboxed frame behind the injected policy", async () => {
  await show("board");
  const frame = await screen.findByTitle("Board");
  expect(frame.getAttribute("sandbox")).toBe("allow-scripts");
  const doc = frame.getAttribute("srcdoc") ?? "";
  expect(doc.startsWith('<meta http-equiv="Content-Security-Policy"')).toBe(true);
  expect(doc).toContain("<p>hello page</p>");
  const brief = screen.getByText("write 1 · SQL · 1 origin");
  expect(brief.getAttribute("title")).toBe(".pages/b.html\ntasks: write · sql · cdn.example.com");
  expect(screen.getByRole("heading", { name: "Board" }).className).toContain("whitespace-nowrap");
});

test("an unknown page says so", async () => {
  await show("nope");
  expect(await screen.findByText("Page not found")).toBeTruthy();
});

test("a frame that loads a second time has navigated away and is cut off", async () => {
  // jsdom loads the srcdoc by itself; that is the first load, so wait for it rather than guess when it lands
  let srcdocLoads = 0;
  const count = () => srcdocLoads++;
  document.addEventListener("load", count, true);
  await show("board");
  const frame = await screen.findByTitle("Board");
  await waitFor(() => expect(srcdocLoads).toBe(1));
  document.removeEventListener("load", count, true);
  expect(screen.queryByRole("alert")).toBeNull();
  fireEvent.load(frame);
  await waitFor(() => expect(screen.getByRole("alert").textContent).toContain("moved to another URL"));
  expect(screen.queryByTitle("Board")).toBeNull();
});

test("a refetch that returns the same html keeps the frame", async () => {
  await show("board");
  const frame = await screen.findByTitle("Board");
  const { queryClient } = await import("@/lib/providers");
  const calls = vi.mocked(api.pageHtml).mock.calls.length;
  await queryClient.invalidateQueries({ queryKey: ["page", "board"] });
  expect(vi.mocked(api.pageHtml).mock.calls.length).toBeGreaterThan(calls);
  expect(screen.getByTitle("Board")).toBe(frame);
  expect(frame.isConnected).toBe(true);
});

test("a change to the page's access in the config replaces the frame", async () => {
  await show("board");
  const frame = await screen.findByTitle("Board");
  const { queryClient } = await import("@/lib/providers");
  const page = snapshot.meta.pages[0] as (typeof snapshot.meta.pages)[number];
  queryClient.setQueryData(["meta"], { ...snapshot.meta, pages: [{ ...page, access: { tasks: "read" } }] });
  await waitFor(() => expect(screen.getByTitle("Board")).not.toBe(frame));
});

test("a frame rebuilt after a theme switch starts with the current theme", async () => {
  document.documentElement.dataset.theme = "light";
  await show("board");
  const frame = await screen.findByTitle("Board");
  document.documentElement.dataset.theme = "dark";
  const { queryClient } = await import("@/lib/providers");
  const page = snapshot.meta.pages[0] as (typeof snapshot.meta.pages)[number];
  queryClient.setQueryData(["meta"], { ...snapshot.meta, pages: [{ ...page, access: { tasks: "read" } }] });
  await waitFor(() => expect(screen.getByTitle("Board")).not.toBe(frame));
  expect(screen.getByTitle("Board").getAttribute("srcdoc")).toContain('(undefined, "dark")');
});

test("a page that cannot be loaded shows why", async () => {
  vi.mocked(api.pageHtml).mockRejectedValueOnce(new Error("page file not found: .pages/b.html"));
  await show("board");
  expect((await screen.findByRole("alert")).textContent).toContain("page file not found: .pages/b.html");
});

test("switching the theme tells the page without rebuilding the frame", async () => {
  document.documentElement.dataset.theme = "light";
  await show("board");
  const frame = (await screen.findByTitle("Board")) as HTMLIFrameElement;
  expect(frame.getAttribute("srcdoc")).toContain('(undefined, "light")');
  const posted: unknown[] = [];
  const win = frame.contentWindow as Window;
  const original = win.postMessage.bind(win);
  win.postMessage = ((m: unknown, o: string) => {
    posted.push(m);
    original(m, o);
  }) as typeof win.postMessage;
  document.documentElement.dataset.theme = "dark";
  await waitFor(() => expect(posted).toContainEqual({ yamlite: 1, event: "theme", data: { theme: "dark" } }));
  expect(screen.getByTitle("Board")).toBe(frame);
});
