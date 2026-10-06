import { cssLanguage } from "@codemirror/lang-css";
import { htmlLanguage } from "@codemirror/lang-html";
import { javascriptLanguage, jsxLanguage, tsxLanguage, typescriptLanguage } from "@codemirror/lang-javascript";
import { jsonLanguage } from "@codemirror/lang-json";
import { markdownLanguage } from "@codemirror/lang-markdown";
import { StandardSQL } from "@codemirror/lang-sql";
import { yamlLanguage } from "@codemirror/lang-yaml";
import type { Language } from "@codemirror/language";
import { classHighlighter, highlightCode } from "@lezer/highlight";

// only the languages the editor already ships, so highlighting a fence adds no parser to the bundle
const LANGUAGES: Record<string, Language> = {
  js: javascriptLanguage,
  javascript: javascriptLanguage,
  mjs: javascriptLanguage,
  cjs: javascriptLanguage,
  jsx: jsxLanguage,
  ts: typescriptLanguage,
  typescript: typescriptLanguage,
  mts: typescriptLanguage,
  tsx: tsxLanguage,
  json: jsonLanguage,
  jsonc: jsonLanguage,
  css: cssLanguage,
  html: htmlLanguage,
  xml: htmlLanguage,
  yaml: yamlLanguage,
  yml: yamlLanguage,
  sql: StandardSQL.language,
  md: markdownLanguage,
  markdown: markdownLanguage,
  mdx: markdownLanguage,
};

export const codeLanguage = (name: string): Language | null => LANGUAGES[name.toLowerCase()] ?? null;

export interface Token {
  text: string;
  className: string;
}

export function highlight(code: string, lang: string): Token[] | null {
  const language = codeLanguage(lang);
  if (!language) return null;
  const tokens: Token[] = [];
  highlightCode(
    code,
    language.parser.parse(code),
    classHighlighter,
    (text, className) => tokens.push({ text, className }),
    () => tokens.push({ text: "\n", className: "" }),
  );
  return tokens;
}
