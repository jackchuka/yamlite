import { expect, test } from "vitest";
import { pageCsp } from "../../../../src/pages/access.ts";
import { injectPage } from "./inject";

const parse = (html: string) => new DOMParser().parseFromString(html, "text/html");

test.each([
  ["a full document", "<!doctype html><html><head><title>x</title></head><body><p>x</p></body></html>"],
  ["a fragment", "<p>bare</p>"],
  ["a commented-out head first", "<!-- <head> --><html><head><title>x</title></head></html>"],
  ["a BOM and an upper-case doctype", "﻿<!DOCTYPE html>\n<p>x</p>"],
])("the policy is the first element of head in %s", (_name, html) => {
  const doc = parse(injectPage(html, []));
  const first = doc.head.firstElementChild;
  expect(first?.tagName).toBe("META");
  expect(first?.getAttribute("http-equiv")).toBe("Content-Security-Policy");
  expect(first?.getAttribute("content")).toBe(pageCsp([]));
  expect(first?.nextElementSibling?.tagName).toBe("STYLE");
  expect(first?.nextElementSibling?.nextElementSibling?.tagName).toBe("SCRIPT");
});

test("a doctype stays first, so the page keeps standards mode", () => {
  expect(parse(injectPage("<!doctype html><p>x</p>", [])).compatMode).toBe("CSS1Compat");
});

test("a comment before the doctype keeps standards mode and the policy first", () => {
  const doc = parse(injectPage("<!-- license --><!doctype html><p>x</p>", []));
  expect(doc.head.firstElementChild?.getAttribute("http-equiv")).toBe("Content-Security-Policy");
  expect(doc.compatMode).toBe("CSS1Compat");
});

test("network origins reach the policy", () => {
  const meta = parse(injectPage("<p>x</p>", ["https://cdn.example.com"])).head.firstElementChild;
  expect(meta?.getAttribute("content")).toBe(pageCsp(["https://cdn.example.com"]));
});

test("many leading comments without a doctype do not stall the injection", () => {
  const html = `${"<!--a-->".repeat(40)}<p>x</p>`;
  const started = performance.now();
  const out = injectPage(html, []);
  expect(performance.now() - started).toBeLessThan(100);
  expect(parse(out).head.firstElementChild?.getAttribute("http-equiv")).toBe("Content-Security-Policy");
});

test("the theme style follows the policy and the sdk is told the initial theme", () => {
  const doc = parse(injectPage("<!doctype html><p>x</p>", [], "dark"));
  const [meta, style, script] = [...doc.head.children];
  expect(meta?.getAttribute("http-equiv")).toBe("Content-Security-Policy");
  expect(style?.tagName).toBe("STYLE");
  expect(style?.id).toBe("yamlite-theme");
  expect(script?.textContent).toContain('"dark"');
});
