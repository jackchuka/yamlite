import { expect, test } from "vitest";
import { isReadOnly } from "./mode";
import { applyMountOptions } from "./mount";

test("a container fit hands the shell the container's height, and readOnly makes the UI read-only", () => {
  const el = document.createElement("div");
  applyMountOptions(el, { readOnly: true, fit: "container" });
  expect(el.style.getPropertyValue("--y-shell-h")).toBe("100%");
  expect(isReadOnly()).toBe(true);
  applyMountOptions(el, {});
  expect(el.style.getPropertyValue("--y-shell-h")).toBe("");
  expect(isReadOnly()).toBe(false);
});

test("mounting applies the saved theme, or the system's when none is saved", () => {
  const el = document.createElement("div");
  delete document.documentElement.dataset.theme;
  localStorage.setItem("yamlite-theme", "dark");
  applyMountOptions(el, {});
  expect(document.documentElement.dataset.theme).toBe("dark");
  localStorage.removeItem("yamlite-theme");
  applyMountOptions(el, {});
  expect(document.documentElement.dataset.theme).toBe(
    matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light",
  );
});
