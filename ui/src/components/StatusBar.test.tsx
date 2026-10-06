import { render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { expect, test, vi } from "vitest";
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
