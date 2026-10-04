import { pageCsp } from "../../../../src/pages/access.ts";
import { pageSdk } from "./sdk";

const DOCTYPE = /^(?:\s*<!--[\s\S]*?-->)*\s*<!doctype[^>]*>/i;
const attr = (s: string) => s.replaceAll("&", "&amp;").replaceAll('"', "&quot;");

// at the very start, not after the page's <head>: a "<head>" inside a comment must not be able to move the policy
export function injectPage(html: string, network: string[]): string {
  const prelude =
    `<meta http-equiv="Content-Security-Policy" content="${attr(pageCsp(network))}">` +
    `<script>(${pageSdk.toString()})();</script>`;
  // a BOM left in a string is text to the HTML parser: it would open the body before the policy
  const body = html.replace(/^\uFEFF/, "");
  const doctype = DOCTYPE.exec(body)?.[0] ?? "";
  return doctype + prelude + body.slice(doctype.length);
}
