import { expect, test } from "vitest";
import { diffText, hunks, isLongText } from "./textdiff";

const text = (segs: { text: string }[]) => segs.map((s) => s.text).join("");

test("multi-line or long strings count as text", () => {
  expect(isLongText("a\nb")).toBe(true);
  expect(isLongText("x".repeat(121))).toBe(true);
  expect(isLongText("short")).toBe(false);
  expect(isLongText(3)).toBe(false);
});

test("a replaced line marks only the changed words", () => {
  const lines = diffText("# Title\n- Influenza vaccination.\n- Other\n", "# Title\n- Flu vaccination.\n- Other\n");
  expect(lines.map((l) => l.kind)).toEqual(["same", "del", "add", "same"]);
  expect(text(lines[1].segments)).toBe("- Influenza vaccination.");
  expect(lines[1].segments.filter((s) => s.mark).map((s) => s.text.trim())).toEqual(["Influenza"]);
  expect(lines[2].segments.filter((s) => s.mark).map((s) => s.text.trim())).toEqual(["Flu"]);
});

test("Japanese text is marked by word, not by the whole line", () => {
  const [del] = diffText("予防接種の費用を負担します\n", "健診の費用を負担します\n");
  expect(del.segments.some((s) => !s.mark && s.text.includes("負担"))).toBe(true);
});

test("pure additions and removals stay whole lines", () => {
  expect(diffText("a\n", "a\nb\n").map((l) => l.kind)).toEqual(["same", "add"]);
  expect(diffText("a\nb\n", "a\n").map((l) => l.kind)).toEqual(["same", "del"]);
});

test("unchanged lines far from a change fold away", () => {
  const before = Array.from({ length: 20 }, (_, i) => `line ${i}`).join("\n");
  const after = before.replace("line 10", "line ten");
  const hs = hunks(diffText(before, after));
  expect(hs.map((h) => [h.kind, h.lines.length])).toEqual([
    ["skip", 8],
    ["lines", 6],
    ["skip", 7],
  ]);
});
