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
  expect(first?.nextElementSibling?.tagName).toBe("SCRIPT");
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
