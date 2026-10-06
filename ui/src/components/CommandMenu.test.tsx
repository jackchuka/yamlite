import { act, render, screen } from "@testing-library/react";
import { expect, test, vi } from "vitest";
import { openCommandMenu } from "@/lib/commandMenu";
import { setMobile } from "@/test/media";
import { CommandMenu } from "./CommandMenu";

vi.mock("@tanstack/react-router", () => ({ useNavigate: () => vi.fn() }));
// cmdk measures its list
globalThis.ResizeObserver ??= class {
  observe() {}
  unobserve() {}
  disconnect() {}
} as unknown as typeof ResizeObserver;
Element.prototype.scrollIntoView ??= () => {};

vi.mock("@/lib/providers", () => ({ useMeta: () => ({ data: { tables: [], views: [], pages: [] } }) }));

test("on a phone the search text keeps clear of the close button and the list fills the screen", () => {
  act(() => setMobile(true));
  render(<CommandMenu />);
  act(() => openCommandMenu());
  expect(screen.getByRole("combobox").className).toContain("max-md:pr-10");
  expect(screen.getByRole("listbox").className).toContain("max-md:max-h-none");
});
