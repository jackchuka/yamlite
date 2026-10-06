import { afterEach, expect, test, vi } from "vitest";
import { getLocale } from "@/paraglide/runtime.js";

const languages = (langs: string[]) => vi.spyOn(navigator, "languages", "get").mockReturnValue(langs);

afterEach(() => vi.restoreAllMocks());

test("a stored choice wins over the browser language", () => {
  languages(["en-US"]);
  localStorage.setItem("yamlite-locale", "ja");
  expect(getLocale()).toBe("ja");
});

test("a Japanese browser gets Japanese on first visit", () => {
  languages(["ja-JP", "en"]);
  expect(getLocale()).toBe("ja");
});

test("any other browser language falls back to English", () => {
  languages(["fr-FR"]);
  expect(getLocale()).toBe("en");
});

test("blocked storage still resolves a locale", () => {
  languages(["ja-JP"]);
  vi.spyOn(window, "localStorage", "get").mockImplementation(() => {
    throw new DOMException("blocked", "SecurityError");
  });
  expect(getLocale()).toBe("ja");
});
