import { render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, expect, test, vi } from "vitest";
import { setEmbedded } from "@/lib/embedded";
import { StatusBar } from "./StatusBar";

let warnings: Record<string, string[]> = {};
vi.mock("@tanstack/react-query", () => ({ useQuery: () => ({ data: { conflicts: [] } }) }));
vi.mock("@tanstack/react-router", () => ({ Link: (p: { children: ReactNode }) => <a>{p.children}</a> }));
vi.mock("@/lib/providers", () => ({
  useEvents: () => ({ connected: true, lastSyncAt: null, warnings }),
  useMeta: () => ({ data: { root: "/data" } }),
}));
vi.mock("./LanguageSelect", () => ({ LanguageSelect: () => null }));

test("warning count uses singular and plural", () => {
  warnings = { t: ["a"] };
  const { unmount } = render(<StatusBar />);
  expect(screen.getByText("⚠ 1 warning")).toBeTruthy();
  unmount();
  warnings = { t: ["a", "b", "c"] };
  render(<StatusBar />);
  expect(screen.getByText("⚠ 3 warnings")).toBeTruthy();
});

test("Japanese has one form", () => {
  localStorage.setItem("yamlite-locale", "ja");
  warnings = { t: ["a"] };
  render(<StatusBar />);
  expect(screen.getByText("⚠ 警告 1 件")).toBeTruthy();
  expect(screen.getByText("/data を監視中")).toBeTruthy();
});

afterEach(() => setEmbedded(false));

test("embedded in another product, the bar shows no local path or address", () => {
  localStorage.removeItem("yamlite-locale");
  warnings = {};
  setEmbedded(true);
  render(<StatusBar />);
  expect(screen.queryByText(/watching/)).toBeNull();
  expect(screen.queryByText(location.host)).toBeNull();
  expect(screen.getByText("connected")).toBeTruthy();
});
