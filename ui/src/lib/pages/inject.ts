import { pageCsp } from "../../../../src/pages/access.ts";
import { pageSdk } from "./sdk";
import { type PageTheme, themeStyle } from "./theme";

// a comment's body cannot span "-->", so there is one way to split leading comments: a lazy body would try them all
const DOCTYPE = /^(?:\s*<!--(?:(?!-->)[\s\S])*-->)*\s*<!doctype[^>]*>/i;
const attr = (s: string) => s.replaceAll("&", "&amp;").replaceAll('"', "&quot;");

// at the very start, not after the page's <head>: a "<head>" inside a comment must not be able to move the policy
export function injectPage(html: string, network: string[], theme: PageTheme = "light"): string {
  const prelude =
    `<meta http-equiv="Content-Security-Policy" content="${attr(pageCsp(network))}">` +
    `<style id="yamlite-theme">${themeStyle()}</style>` +
    `<script>(${pageSdk.toString()})(undefined, ${JSON.stringify(theme).replaceAll("<", "\\u003c")});</script>`;
  // a BOM left in a string is text to the HTML parser: it would open the body before the policy
  const body = html.replace(/^\uFEFF/, "");
  const doctype = DOCTYPE.exec(body)?.[0] ?? "";
  return doctype + prelude + body.slice(doctype.length);
}
