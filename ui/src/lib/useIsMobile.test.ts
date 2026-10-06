import { act, renderHook } from "@testing-library/react";
import { expect, test } from "vitest";
import { setMobile } from "@/test/media";
import { useIsMobile } from "./useIsMobile";

test("follows the mobile media query as it changes", () => {
  const { result } = renderHook(() => useIsMobile());
  expect(result.current).toBe(false);
  act(() => setMobile(true));
  expect(result.current).toBe(true);
  act(() => setMobile(false));
  expect(result.current).toBe(false);
});

test("uses the same breakpoint as Tailwind's md", async () => {
  const { MOBILE_QUERY } = await import("./useIsMobile");
  expect(MOBILE_QUERY).toBe("(width < 48rem)");
});
