import { render, screen, waitFor } from "@testing-library/react";
import { expect, test, vi } from "vitest";
import { StaleDialog } from "./StaleDialog";

const lines = (n: number, edit: string) =>
  Array.from({ length: n }, (_, i) => (i === n - 1 ? edit : `line ${i}`)).join("\n");

test("a changed body shows as a line diff and focus starts on reload", async () => {
  render(
    <StaleDialog
      stale={["body"]}
      current={{ body: lines(20, "theirs") }}
      draft={{ body: lines(20, "mine") }}
      onReload={vi.fn()}
      onOverwrite={vi.fn()}
      onClose={vi.fn()}
    />,
  );
  expect(screen.getByRole("group", { name: "body" }).querySelectorAll("mark")).toHaveLength(2);
  await waitFor(() => expect(document.activeElement).toBe(screen.getByRole("button", { name: "Load latest" })));
});
