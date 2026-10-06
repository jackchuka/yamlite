import { act, renderHook } from "@testing-library/react";
import { beforeEach, expect, test } from "vitest";
import { MIN_COLUMN_WIDTH, useGridPrefs } from "./gridPrefs";

beforeEach(() => localStorage.clear());

test("widths and the pin are kept per table", () => {
  const { result } = renderHook(() => useGridPrefs("tasks"));
  act(() => result.current.setWidth("title", 240.4));
  act(() => result.current.togglePin());
  expect(result.current.widths).toEqual({ title: 240 });
  expect(result.current.unpinned).toBe(true);
  expect(renderHook(() => useGridPrefs("tasks")).result.current).toMatchObject({
    widths: { title: 240 },
    unpinned: true,
  });
  expect(renderHook(() => useGridPrefs("people")).result.current).toMatchObject({ widths: {}, unpinned: false });
});

test("a width has a floor, and null resets it", () => {
  const { result } = renderHook(() => useGridPrefs("tasks"));
  act(() => result.current.setWidth("title", 5));
  expect(result.current.widths.title).toBe(MIN_COLUMN_WIDTH);
  act(() => result.current.setWidth("title", null));
  expect(result.current.widths).toEqual({});
});

test("broken storage falls back to the defaults", () => {
  localStorage.setItem("yamlite-grid:tasks", "{not json");
  expect(renderHook(() => useGridPrefs("tasks")).result.current).toMatchObject({ widths: {}, unpinned: false });
});
