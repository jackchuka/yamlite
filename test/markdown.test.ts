import { describe, expect, test } from "vitest";
import { markdownCodec, splitFrontMatter } from "../src/source/markdown.ts";

const md = markdownCodec("body");
const keepNone = () => false;
const keepId = (f: string) => f === "id";
const read = (content: string) => md.read(content);

describe("reading", () => {
  test("front matter fields become columns and the text below is the body, blank lines included", () => {
    expect(read("---\ntitle: A\ntags: [x, y]\n---\n\n# Hi\n")).toEqual({
      ok: true,
      record: { title: "A", tags: ["x", "y"], body: "\n# Hi\n" },
    });
  });

  test("a file without front matter is all body", () => {
    expect(read("# Note\n\ntext\n")).toEqual({ ok: true, record: { body: "# Note\n\ntext\n" } });
    expect(read("")).toEqual({ ok: true, record: { body: "" } });
  });

  test("an empty front matter block has no fields", () => {
    expect(read("---\n---\nbody\n")).toEqual({ ok: true, record: { body: "body\n" } });
  });

  test("a --- line in the body stays in the body", () => {
    expect(read("---\na: 1\n---\nabove\n---\nbelow\n")).toEqual({
      ok: true,
      record: { a: 1n, body: "above\n---\nbelow\n" },
    });
  });

  test("CRLF files and a BOM are read like the rest", () => {
    expect(read("\uFEFF---\r\ntitle: A\r\n---\r\nline\r\n")).toEqual({
      ok: true,
      record: { title: "A", body: "line\r\n" },
    });
  });

  test.each([
    ["+++\ntitle = 'A'\n+++\nbody\n", "TOML front matter is not supported"],
    ['{\n  "title": "A"\n}\nbody\n', "JSON front matter is not supported"],
    ["---\ntitle: A\nbody\n", "front matter is not closed"],
    ["---\n- a\n- b\n---\nbody\n", "front matter must be a mapping"],
    ["---\nbody: x\n---\ntext\n", 'front matter has a "body" field; set body: to another column name'],
  ])("%j is skipped: %s", (content, error) => {
    expect(read(content)).toEqual({ ok: false, error });
  });

  test("a YAML error in the front matter reads like one in a YAML file", () => {
    const r = read("---\ntitle: [unclosed\n---\nbody\n");
    expect(r.ok).toBe(false);
    expect(r.ok ? "" : r.error).toMatch(/at line/);
  });

  test("the body column can be renamed", () => {
    expect(markdownCodec("content").read("---\nbody: x\n---\ntext\n")).toEqual({
      ok: true,
      record: { body: "x", content: "text\n" },
    });
  });

  test("splitFrontMatter keeps the BOM and line ending for writing back", () => {
    expect(splitFrontMatter("\uFEFF---\r\na: 1\r\n---\r\nx")).toEqual({
      ok: true,
      split: { bom: "\uFEFF", eol: "\r\n", front: "a: 1\r\n", body: "x" },
    });
  });
});

describe("writing", () => {
  const roundTrip = (content: string) => {
    const r = read(content);
    if (!r.ok) throw new Error(r.error);
    return md.write(content, r.record, keepNone);
  };

  test.each([
    "---\ntitle:   A  # note\ntags: [x]\n---\n\n# Hi\n",
    "# no front matter\n",
    "---\n---\nbody\n",
    "\uFEFF---\r\ntitle: A\r\n---\r\nline\r\n",
    "",
  ])("an unchanged record writes the same bytes: %j", (content) => {
    expect(roundTrip(content)).toBe(content);
  });

  test("changing only the body leaves the front matter text as it was", () => {
    const content = "---\ntitle:   A  # note\n---\nold\n";
    expect(md.write(content, { title: "A", body: "new\n" }, keepNone)).toBe("---\ntitle:   A  # note\n---\nnew\n");
  });

  test("changing a field rewrites the front matter and leaves the body bytes alone", () => {
    const content = "---\n# keep me\ntitle: A\n---\n\n  body  \n";
    expect(md.write(content, { title: "B", body: "\n  body  \n" }, keepNone)).toBe(
      "---\n# keep me\ntitle: B\n---\n\n  body  \n",
    );
  });

  test("a field added to a file without front matter opens a block", () => {
    expect(md.write("# x\n", { title: "A", body: "# x\n" }, keepNone)).toBe("---\ntitle: A\n---\n# x\n");
  });

  test("removing every field keeps an empty block", () => {
    expect(md.write("---\ntitle: A\n---\nx\n", { title: null, body: "x\n" }, keepNone)).toBe("---\n---\nx\n");
  });

  test("a null body writes an empty body", () => {
    expect(md.write("---\na: 1\n---\nold\n", { a: 1n, body: null }, keepNone)).toBe("---\na: 1\n---\n");
  });

  test("new files: front matter only when there are fields", () => {
    expect(md.write(null, { body: "hi\n" }, keepNone)).toBe("hi\n");
    expect(md.write(null, { title: "A", body: "hi\n" }, keepNone)).toBe("---\ntitle: A\n---\nhi\n");
  });

  test("the key field stays in the front matter when the record leaves it out", () => {
    expect(md.write("---\nid: a\ntitle: A\n---\nx\n", { title: "B", body: "x\n" }, keepId)).toBe(
      "---\nid: a\ntitle: B\n---\nx\n",
    );
  });

  test("CRLF and a BOM survive a field change", () => {
    expect(md.write("\uFEFF---\r\ntitle: A\r\n---\r\nx\r\n", { title: "B", body: "x\r\n" }, keepNone)).toBe(
      "\uFEFF---\r\ntitle: B\r\n---\r\nx\r\n",
    );
  });

  test.each(["---\nx: 1\n---\n", "+++\n", "{\n"])(
    "a body that looks like front matter reads back as body: %j",
    (text) => {
      for (const current of [null, "hi\n"]) {
        const written = md.write(current, { body: text }, keepNone);
        expect(read(written)).toEqual({ ok: true, record: { body: text } });
      }
    },
  );

  test("a Uint8Array body is written as UTF-8 text", () => {
    expect(md.write(null, { body: new TextEncoder().encode("hi\n") }, keepNone)).toBe("hi\n");
  });
});
