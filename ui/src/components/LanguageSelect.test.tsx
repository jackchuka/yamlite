import { fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeAll, expect, test, vi } from "vitest";
import { LanguageSelect } from "./LanguageSelect";

const setLocale = vi.fn();
vi.mock("@/paraglide/runtime.js", async (orig) => ({
  ...(await orig<typeof import("@/paraglide/runtime.js")>()),
  setLocale: (l: string) => setLocale(l),
}));

beforeAll(() => {
  Element.prototype.scrollIntoView ??= () => {};
  Element.prototype.hasPointerCapture ??= () => false;
  Element.prototype.releasePointerCapture ??= () => {};
});
afterEach(() => setLocale.mockReset());

const open = () =>
  fireEvent.pointerDown(screen.getByRole("combobox", { name: "Language" }), { button: 0, pointerType: "mouse" });

test("lists every locale in its own language", () => {
  render(<LanguageSelect />);
  open();
  expect(screen.getByRole("option", { name: "English" })).toBeTruthy();
  expect(screen.getByRole("option", { name: "日本語" })).toBeTruthy();
});

test("picking a language switches to it", () => {
  render(<LanguageSelect />);
  open();
  fireEvent.click(screen.getByRole("option", { name: "日本語" }));
  expect(setLocale).toHaveBeenCalledWith("ja");
});

test("picking the current language does nothing", () => {
  render(<LanguageSelect />);
  open();
  fireEvent.click(screen.getByRole("option", { name: "English" }));
  expect(setLocale).not.toHaveBeenCalled();
});
