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
