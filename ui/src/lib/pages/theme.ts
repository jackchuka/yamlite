import mono400 from "@fontsource/jetbrains-mono/files/jetbrains-mono-latin-400-normal.woff2?inline";
import outfit400 from "@fontsource/outfit/files/outfit-latin-400-normal.woff2?inline";
import outfit500 from "@fontsource/outfit/files/outfit-latin-500-normal.woff2?inline";
import outfit600 from "@fontsource/outfit/files/outfit-latin-600-normal.woff2?inline";

export type PageTheme = "light" | "dark";

// the same values as ui/src/styles.css (Cream and Ink); theme.test.ts keeps them in step
export const TOKENS: Record<PageTheme, Record<string, string>> = {
  light: {
    "--y-bg": "#fffdf9",
    "--y-panel": "#fff7ed",
    "--y-panel-2": "#fde3d6",
    "--y-line": "#eadfd0",
    "--y-text": "#1c1b29",
    "--y-muted": "#8a8796",
    "--y-accent": "#e5484d",
    "--y-accent-fill": "#e5484d",
    "--y-accent-soft": "#fde3d6",
    "--y-on-accent": "#fff7ed",
    "--y-ok": "#2f9e6e",
    "--y-warn": "#c27a12",
    "--y-warn-soft": "#fbecc8",
    "--y-err": "#e5484d",
    "--y-err-soft": "#fde3d6",
    "--y-chip": "#fde3d6",
    "--y-chip-text": "#a8282d",
  },
  dark: {
    "--y-bg": "#1c1b29",
    "--y-panel": "#232232",
    "--y-panel-2": "#2d2b3e",
    "--y-line": "#34324a",
    "--y-text": "#f4efe6",
    "--y-muted": "#8a8796",
    "--y-accent": "#ff6b6f",
    "--y-accent-fill": "#e5484d",
    "--y-accent-soft": "#3a2433",
    "--y-on-accent": "#fff7ed",
    "--y-ok": "#7ad3a4",
    "--y-warn": "#f0b654",
    "--y-warn-soft": "#3a3020",
    "--y-err": "#ff6b6f",
    "--y-err-soft": "#3a2433",
    "--y-chip": "#3a2433",
    "--y-chip-text": "#ffc9c4",
  },
};

const vars = (t: Record<string, string>) =>
  Object.entries(t)
    .map(([k, v]) => `${k}:${v};`)
    .join("");
const face = (family: string, weight: number, src: string) =>
  `@font-face{font-family:"${family}";font-weight:${weight};font-style:normal;font-display:swap;src:url(${src}) format("woff2");}`;
// every comma-separated selector gets the scope prefix
const ui = (selector: string, body: string) =>
  `:where(${selector
    .split(",")
    .map((s) => `[data-yamlite-ui] ${s.trim()}`)
    .join(", ")}){${body}}`;

const BASE = [
  ui("body", "margin:0;padding:16px;background:var(--y-bg);color:var(--y-text);font:14px/1.55 var(--y-font);"),
  ui("h1", "font-size:18px;font-weight:600;margin:0 0 12px;"),
  ui("h2", "font-size:15px;font-weight:600;margin:20px 0 8px;"),
  ui("h3", "font-size:13px;font-weight:600;margin:16px 0 6px;"),
  ui("a", "color:var(--y-accent);text-decoration:none;"),
  ui("a:hover", "text-decoration:underline;"),
  ui(
    "button",
    "font:500 13px/1 var(--y-font);padding:7px 12px;border-radius:6px;border:1px solid var(--y-line);background:var(--y-bg);color:var(--y-text);cursor:pointer;",
  ),
  ui("button:hover", "background:var(--y-panel);"),
  ui("button:disabled", "opacity:.5;cursor:default;"),
  ui("button.y-primary", "background:var(--y-accent-fill);border-color:var(--y-accent-fill);color:var(--y-on-accent);"),
  ui(
    "input, select, textarea",
    "font:13px/1.4 var(--y-font);padding:6px 8px;border-radius:6px;border:1px solid var(--y-line);background:var(--y-bg);color:var(--y-text);",
  ),
  ui(
    "input:focus, select:focus, textarea:focus, button:focus-visible",
    "outline:2px solid var(--y-accent);outline-offset:1px;",
  ),
  ui(
    ".y-link, .y-link:hover",
    "background:none;border:0;border-radius:0;padding:0;font:inherit;color:var(--y-accent);cursor:pointer;",
  ),
  ui(".y-link", "text-decoration:none;"),
  ui(".y-link:hover", "text-decoration:underline;"),
  ui("input[type=checkbox], input[type=radio]", "accent-color:var(--y-accent-fill);padding:0;"),
  ui("table", "width:100%;border-collapse:collapse;"),
  ui(
    "th, td",
    "text-align:left;vertical-align:top;padding:6px 10px;border-bottom:1px solid var(--y-line);overflow-wrap:anywhere;",
  ),
  ui("th", "background:var(--y-panel);font-size:12px;font-weight:600;color:var(--y-muted);"),
  ui("thead th", "position:sticky;top:0;"),
  ui("code, pre", "font-family:var(--y-mono);font-size:12px;background:var(--y-panel);border-radius:4px;"),
  ui("code", "padding:1px 4px;"),
  ui("pre", "padding:10px 12px;overflow-x:auto;"),
  ui("details", "border:1px solid var(--y-line);border-radius:8px;padding:0 12px;margin:8px 0;"),
  ui("summary", "cursor:pointer;padding:10px 0;font-weight:600;"),
  ui(
    ".y-chip",
    "display:inline-block;padding:1px 8px;border-radius:999px;font-size:12px;line-height:1.6;background:var(--y-chip);color:var(--y-chip-text);",
  ),
  ui(".y-chip.y-ok", "background:var(--y-panel);color:var(--y-ok);"),
  ui(".y-chip.y-warn", "background:var(--y-warn-soft);color:var(--y-warn);"),
  ui(".y-chip.y-err", "background:var(--y-err-soft);color:var(--y-err);"),
  ui(".y-muted", "color:var(--y-muted);"),
  ui(
    ".y-card",
    "background:var(--y-panel);border:1px solid var(--y-line);border-radius:8px;padding:12px 14px;margin:8px 0;",
  ),
  ui(".y-toolbar", "display:flex;flex-wrap:wrap;align-items:center;gap:8px;margin:0 0 12px;"),
];

export function themeStyle(): string {
  return [
    face("Outfit", 400, outfit400),
    face("Outfit", 500, outfit500),
    face("Outfit", 600, outfit600),
    face("JetBrains Mono", 400, mono400),
    `:root{${vars(TOKENS.light)}--y-font:"Outfit",system-ui,sans-serif;--y-mono:"JetBrains Mono",ui-monospace,monospace;}`,
    `:root[data-theme="dark"]{${vars(TOKENS.dark)}}`,
    ":where([data-yamlite-ui]){color-scheme:light}",
    ':where([data-yamlite-ui][data-theme="dark"]){color-scheme:dark}',
    ...BASE,
  ].join("");
}
