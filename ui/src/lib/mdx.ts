import { fromMarkdown } from "mdast-util-from-markdown";
import { mdxExpressionFromMarkdown } from "mdast-util-mdx-expression";
import { mdxJsxFromMarkdown } from "mdast-util-mdx-jsx";
import { mdx } from "micromark-extension-mdx";
import { ESM } from "./cell";

interface Node {
  type: string;
  value?: string;
  name?: string | null;
  attributes?: Attribute[];
  children?: Node[];
  data?: Record<string, unknown>;
  position?: { start: { offset?: number }; end: { offset?: number } };
}

type Attribute =
  | { type: "mdxJsxAttribute"; name: string; value?: string | { value: string } | null }
  | { type: "mdxJsxExpressionAttribute"; value: string };

const text = (value: string) => ({ type: "text", value });
const element = (tagName: string, className: string | null, children: unknown[]) => ({
  type: "element",
  tagName,
  properties: className ? { className: [className] } : {},
  children,
});

export function openTag(node: Node): string {
  const attrs = (node.attributes ?? []).map((a) => {
    if (a.type === "mdxJsxExpressionAttribute") return `{${a.value}}`;
    if (a.value == null) return a.name;
    return typeof a.value === "string" ? `${a.name}="${a.value}"` : `${a.name}={${a.value.value}}`;
  });
  const head = [node.name ?? "", ...attrs].join(" ");
  return node.children?.length ? `<${head}>` : `<${head} />`;
}

const esm = (source: string) => ({
  hName: "details",
  hProperties: { className: ["mdx-esm"] },
  hChildren: [
    element("summary", null, [text(source.split("\n")[0])]),
    element("pre", null, [element("code", "language-js", [text(source)])]),
  ],
});

// gives each MDX node a plain element to render as, so the preview shows the JSX instead of executing it
function toPreview(node: Node) {
  switch (node.type) {
    case "mdxJsxFlowElement":
    case "mdxJsxTextElement": {
      const flow = node.type === "mdxJsxFlowElement";
      const tag = flow ? "div" : "span";
      const label = openTag(node);
      node.data = { hName: tag, hProperties: { className: [flow ? "mdx-jsx" : "mdx-jsx-inline"], title: label } };
      // inline, the tag would break up the sentence, so it only shows when there is no text to show instead
      if (flow || !node.children?.length) {
        const tagNode = {
          type: "mdxPreviewTag",
          data: { hName: tag, hProperties: { className: ["mdx-tag"] }, hChildren: [text(label)] },
        };
        node.children = [tagNode, ...(node.children ?? [])];
      }
      break;
    }
    case "mdxFlowExpression":
    case "mdxTextExpression":
      node.data = {
        hName: "code",
        hProperties: { className: ["mdx-expr"] },
        hChildren: [text(`{${node.value ?? ""}}`)],
      };
      break;
  }
  node.children?.forEach(toPreview);
}

// the parser does not know JavaScript, so a top-level import/export block arrives as a paragraph; its source says what it was
function markEsm(tree: Node, source: string) {
  for (const node of tree.children ?? []) {
    const start = node.position?.start.offset;
    const end = node.position?.end.offset;
    if (node.type !== "paragraph" || start === undefined || end === undefined) continue;
    const value = source.slice(start, end);
    if (!ESM.test(value)) continue;
    node.type = "mdxPreviewEsm";
    node.children = [];
    node.data = esm(value);
  }
}

const MDX_EXTENSIONS = { extensions: [mdx()], mdastExtensions: [mdxJsxFromMarkdown(), mdxExpressionFromMarkdown()] };

// MDX without JavaScript awareness: the preview shows JSX and expressions as written, so it needs no JS parser
export function remarkMdx(this: { data: () => object }) {
  const data = this.data() as Record<string, unknown[] | undefined>;
  data.micromarkExtensions = [...(data.micromarkExtensions ?? []), ...MDX_EXTENSIONS.extensions];
  data.fromMarkdownExtensions = [...(data.fromMarkdownExtensions ?? []), ...MDX_EXTENSIONS.mdastExtensions];
}

export function remarkMdxPreview() {
  return (tree: Node, file: { value: unknown }) => {
    markEsm(tree, String(file.value));
    toPreview(tree);
  };
}

// the MDX parser throws on the first syntax error; the preview falls back to plain Markdown and says why
export function mdxError(source: string): string | null {
  try {
    fromMarkdown(source, MDX_EXTENSIONS);
    return null;
  } catch (e) {
    return e instanceof Error ? e.message : String(e);
  }
}
