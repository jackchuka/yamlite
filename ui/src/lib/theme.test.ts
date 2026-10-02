import { expect, test } from "vitest";
import { nextChoice, resolveTheme } from "./theme";

test("system follows the OS, explicit choices win", () => {
  expect(resolveTheme("system", true)).toBe("dark");
  expect(resolveTheme("system", false)).toBe("light");
  expect(resolveTheme("light", true)).toBe("light");
  expect(resolveTheme("dark", false)).toBe("dark");
});

test("the toggle cycles system → light → dark → system", () => {
  expect(nextChoice("system")).toBe("light");
  expect(nextChoice("light")).toBe("dark");
  expect(nextChoice("dark")).toBe("system");
});
