import { act, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, expect, test, vi } from "vitest";
import { mount } from "./embed";

vi.mock("@/lib/providers", () => ({
  Providers: ({ children }: { children: ReactNode }) => children,
  useEvents: () => ({ configError: null, connected: true }),
  useMeta: () => ({ data: undefined }),
}));
vi.mock("@/lib/ai", async (orig) => ({ ...(await orig<typeof import("@/lib/ai")>()), useAiProviders: () => null }));
vi.mock("@/lib/useIsMobile", () => ({ useIsMobile: () => false }));
vi.mock("@/components/ui/sonner", () => ({ Toaster: () => null }));
vi.mock("./components/PageView", () => ({
  PageView: ({ name, app }: { name: string; app?: boolean }) => (
    <p>{`${name} ${app ? "as an app" : "in the editor"}`}</p>
  ),
}));
vi.mock("./components/CommandMenu", () => ({ CommandMenu: () => null }));
vi.mock("./components/SessionBanner", () => ({ SessionBanner: () => null }));
vi.mock("./components/ConflictToasts", () => ({ ConflictToasts: () => null }));
vi.mock("./components/NewTableDialog", () => ({ NewTableDialog: () => null }));
vi.mock("./components/MobileNav", () => ({ MobileNav: () => null }));
vi.mock("./components/Sidebar", () => ({ Sidebar: () => <nav aria-label="sidebar" /> }));
vi.mock("./components/StatusBar", () => ({ StatusBar: () => <footer aria-label="status" /> }));
vi.mock("./components/AgentPanel", () => ({ AgentPanel: () => null }));

const transport = { fetch: vi.fn(), eventSource: vi.fn() } as never;
let unmount: (() => void) | undefined;
afterEach(() => {
  act(() => unmount?.());
  unmount = undefined;
  document.body.replaceChildren();
  history.replaceState(null, "", "/");
});

function start(o: { app?: string } = {}) {
  const el = document.createElement("div");
  document.body.append(el);
  act(() => {
    unmount = mount(el, { transport, ...o });
  });
}

test("the app option opens the page as an app, and the address is left alone", async () => {
  history.replaceState(null, "", "/host/path");
  start({ app: "team board" });
  expect(await screen.findByText("team board as an app")).toBeTruthy();
  expect(screen.queryByRole("navigation", { name: "sidebar" })).toBeNull();
  expect(screen.queryByRole("contentinfo", { name: "status" })).toBeNull();
  expect(location.pathname).toBe("/host/path");
  expect(location.hash).toBe("");
});

test("a #/app/ hash opens the page in the editor, not as an app", async () => {
  history.replaceState(null, "", "/#/app/board");
  start();
  expect(await screen.findByText("board in the editor")).toBeTruthy();
  expect(screen.getByRole("navigation", { name: "sidebar" })).toBeTruthy();
  expect(location.hash).toBe("#/p/board");
});
