import { render, screen } from "@testing-library/react";
import { expect, test } from "vitest";
import type { ColumnType } from "@/lib/types";
import { RuleForm } from "./RuleForm";

const none = { required: [], values: {}, formats: {}, min: {}, max: {}, references: {} };
const form = (type: ColumnType) =>
  render(
    <RuleForm column="c" type={type} draft={none} tables={[]} hints={[]} set={() => {}} toggleRequired={() => {}} />,
  );

test.each(["INTEGER", "REAL", "BOOLEAN"] as const)("a %s column has no format", (type) => {
  form(type);
  expect(screen.queryByLabelText("Format")).toBeNull();
});

test.each([
  ["TEXT", ["", "date", "datetime", "markdown"]],
  ["JSON", ["", "list", "map"]],
] as const)("a %s column offers its own formats", (type, options) => {
  form(type);
  expect([...(screen.getByLabelText("Format") as HTMLSelectElement).options].map((o) => o.value)).toEqual(options);
});
