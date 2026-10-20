import { render, screen } from "@testing-library/react";
import { afterEach, expect, test, vi } from "vitest";
import { setAppFooter } from "@/lib/appMode";
import { AppFooter } from "./AppFooter";

vi.mock("./SendForReview", () => ({ SendForReview: () => <button type="button">Send for review</button> }));
afterEach(() => setAppFooter(undefined));

test("the host's part sits at the left of the bar, before Send for review", () => {
  const host = document.createElement("div");
  host.innerHTML = "<span>Latest data</span>";
  setAppFooter(host);
  const { unmount } = render(<AppFooter />);
  const footer = screen.getByRole("contentinfo");
  expect(footer.firstElementChild?.firstElementChild).toBe(host);
  expect(footer.textContent).toBe("Latest dataSend for review");
  unmount();
  expect(host.isConnected).toBe(false);
});

test("without a host's part the bar holds only the edits", () => {
  render(<AppFooter />);
  expect(screen.getByRole("contentinfo").textContent).toBe("Send for review");
});
