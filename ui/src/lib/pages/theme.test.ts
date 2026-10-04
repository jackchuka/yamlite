import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { expect, test } from "vitest";
import { TOKENS, themeStyle } from "./theme";

// vitest turns a css import into an empty string, even with ?raw, so the file is read directly
const styles = readFileSync(resolve(__dirname, "../../styles.css"), "utf8");

const block = (selector: string) => {
  const start = styles.indexOf(`${selector} {`);
  const body = styles.slice(start, styles.indexOf("}", start));
  return Object.fromEntries([...body.matchAll(/(--y-[a-z0-9-]+):\s*([^;]+);/g)].map((m) => [m[1], m[2].trim()]));
};

test("the tokens match the UI's Cream and Ink palettes", () => {
  // --y-k, --y-s and --y-n are the UI's own and not part of the page API
  const pub = (b: Record<string, string>) =>
    Object.fromEntries(Object.entries(b).filter(([k]) => !["--y-k", "--y-s", "--y-n"].includes(k)));
  expect(TOKENS.light).toEqual(pub(block(":root")));
  expect(TOKENS.dark).toEqual(pub(block('[data-theme="dark"]')));
});

test("the style defines both themes, the fonts, and scopes the base styles", () => {
  const css = themeStyle();
  expect(css).toContain(':root[data-theme="dark"]');
  expect(css).toContain("--y-font:");
  expect(css).toContain("--y-mono:");
  expect((css.match(/@font-face/g) ?? []).length).toBe(4);
  expect(css).toContain("url(data:font/woff2");
  const rules = css
    .split("}")
    .map((r) => r.trim())
    .filter((r) => r.includes("{") && !r.startsWith("@"))
    .map((r) => ({ selector: r.slice(0, r.indexOf("{")), body: r.slice(r.indexOf("{") + 1) }))
    .filter((r) => r.selector !== ":root" && r.selector !== ':root[data-theme="dark"]');
  expect(rules.length).toBeGreaterThan(0);
  const optIn = ["[data-yamlite-ui]", '[data-yamlite-ui][data-theme="dark"]'];
  for (const { selector } of rules) {
    expect(selector.startsWith(":where(")).toBe(true);
    for (const part of selector.slice(":where(".length, -1).split(",")) {
      const p = part.trim();
      expect(optIn.includes(p) || p.startsWith("[data-yamlite-ui] ")).toBe(true);
    }
  }
});

test("color-scheme is set only for pages that opt in", () => {
  const css = themeStyle();
  expect(css).toContain(":root{--y-bg:");
  expect(css).toContain(':root[data-theme="dark"]{--y-bg:');
  const rootBlocks = css.split("}").filter((r) => r.startsWith(":root"));
  expect(rootBlocks.length).toBe(2);
  for (const block of rootBlocks) expect(block).not.toContain("color-scheme");
  expect(css).toContain(":where([data-yamlite-ui]){color-scheme:light}");
  expect(css).toContain(':where([data-yamlite-ui][data-theme="dark"]){color-scheme:dark}');
});

test(".y-link comes after every button rule so it wins on a button", () => {
  const css = themeStyle();
  const link = css.indexOf("[data-yamlite-ui] .y-link");
  expect(link).toBeGreaterThan(-1);
  let last = -1;
  for (const m of css.matchAll(/\[data-yamlite-ui\] button[^{]*\{/g)) last = m.index ?? -1;
  expect(last).toBeGreaterThan(-1);
  expect(link).toBeGreaterThan(last);
  expect(css).toContain("[data-yamlite-ui] thead th");
  expect(css).not.toMatch(/\[data-yamlite-ui\] th\)\{[^}]*sticky/);
});
