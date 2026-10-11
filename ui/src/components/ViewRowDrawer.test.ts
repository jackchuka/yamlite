import { expect, test } from "vitest";
import { getIn } from "./ViewRowDrawer";

test("a list item is found by its position whether it comes as a number or as text", () => {
  const record = { tags: ["afea"], meta: { test: "afea" } };
  expect(getIn(record, ["tags", 0])).toBe("afea");
  // a view over lists and maps names every position by a text key
  expect(getIn(record, ["tags", "0"])).toBe("afea");
  expect(getIn(record, ["meta", "test"])).toBe("afea");
  expect(getIn(record, ["tags", "x"])).toBeUndefined();
});
