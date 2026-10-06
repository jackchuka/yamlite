import { act, renderHook } from "@testing-library/react";
import { expect, test } from "vitest";
import { openCommandMenu, setCommandMenuOpen, useCommandMenuOpen } from "./commandMenu";

test("opens and toggles from anywhere", () => {
  const { result } = renderHook(() => useCommandMenuOpen());
  expect(result.current).toBe(false);
  act(() => openCommandMenu());
  expect(result.current).toBe(true);
  act(() => setCommandMenuOpen((o) => !o));
  expect(result.current).toBe(false);
});
