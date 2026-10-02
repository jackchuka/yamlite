import { expect, test } from "vitest";
import { referenceSearch } from "./references";
import type { TableMeta } from "./types";

const people = { name: "people", key: "slug" } as TableMeta;

test("a reference to the key opens the record, one to another column filters by it", () => {
  expect(referenceSearch({ column: "owner", table: "people" }, [people], "ann")).toEqual({ key: "ann" });
  expect(referenceSearch({ column: "owner", table: "people", target: "slug" }, [people], "ann")).toEqual({
    key: "ann",
  });
  expect(referenceSearch({ column: "owner", table: "people", target: "email" }, [people], "a@x")).toEqual({
    filter: [{ col: "email", op: "eq", value: "a@x" }],
  });
});
