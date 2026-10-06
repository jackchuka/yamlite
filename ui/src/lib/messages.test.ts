import { expect, test } from "vitest";
import en from "../../messages/en.json";
import ja from "../../messages/ja.json";

test("en and ja define the same message keys", () => {
  const keys = (o: object) =>
    Object.keys(o)
      .filter((k) => k !== "$schema")
      .sort();
  expect(keys(ja)).toEqual(keys(en));
});
