import { render } from "@testing-library/react";
import { expect, test } from "vitest";
import { Highlight, SearchTerm, splitMatches } from "./highlight";

test("every match is split out, ignoring case", () => {
  expect(splitMatches("Buy milk, MILK", "milk")).toEqual([
    { text: "Buy ", match: false },
    { text: "milk", match: true },
    { text: ", ", match: false },
    { text: "MILK", match: true },
  ]);
  expect(splitMatches("abc", "")).toEqual([{ text: "abc", match: false }]);
  expect(splitMatches("abc", "x")).toEqual([{ text: "abc", match: false }]);
});

test("matches are marked only while searching", () => {
  const { container, rerender } = render(<Highlight text="Buy milk" />);
  expect(container.querySelector("mark")).toBeNull();
  rerender(
    <SearchTerm.Provider value="MIL">
      <Highlight text="Buy milk" />
    </SearchTerm.Provider>,
  );
  expect(container.querySelector("mark")?.textContent).toBe("mil");
  expect(container.textContent).toBe("Buy milk");
});
