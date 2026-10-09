import { expect, test } from "vitest";
import { yamlCodec } from "../src/source/yamldoc.ts";

const write = (current: string, record: Record<string, unknown>) => yamlCodec.write(current, record, () => false);

test("an edit inside a list keeps the comments on the items around it", () => {
  const current = [
    "title: Website",
    "milestones:",
    "  # the first one",
    "  - title: Design # in review",
    "    tasks:",
    "      - title: Wireframes",
    "  - title: Launch # later",
    "",
  ].join("\n");
  const out = write(current, {
    title: "Website",
    milestones: [{ title: "Design", tasks: [{ title: "Mockups" }] }, { title: "Launch" }],
  });
  expect(out).toBe(current.replace("Wireframes", "Mockups"));
});

test("items and fields come and go inside a nested value", () => {
  const current = "tags:\n  - a # first\n  - b\n  - c\nmeta:\n  x: 1 # kept\n  y: 2\n";
  const out = write(current, { tags: ["a", "z"], meta: { x: 1n, z: true } });
  expect(out).toBe("tags:\n  - a # first\n  - z\nmeta:\n  x: 1 # kept\n  z: true\n");
});

test("a value that changes shape is written anew", () => {
  expect(write("a:\n  - 1\n", { a: { b: "c" } })).toBe("a:\n  b: c\n");
  expect(write("a: text\n", { a: 5n })).toBe("a: 5\n");
});

test("a file written with long lines is not rewrapped by an edit elsewhere in it", () => {
  const long = `note: ${"word ".repeat(30).trim()}\n`;
  expect(write(`${long}value: extend\n`, { note: "word ".repeat(30).trim(), value: "fit" })).toBe(
    `${long}value: fit\n`,
  );
});

test("a file wrapped at 80 columns stays wrapped", () => {
  const wrapped = write("value: a\n", { value: "a", note: "word ".repeat(30).trim() });
  expect(wrapped.split("\n").every((l) => l.length <= 80)).toBe(true);
  expect(write(wrapped, { value: "b", note: "word ".repeat(30).trim() })).toBe(wrapped.replace("value: a", "value: b"));
});
