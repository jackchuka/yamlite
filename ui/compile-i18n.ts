import { readFileSync } from "node:fs";
import { compile } from "@inlang/paraglide-js";
import { paraglideOptions } from "./paraglide.config.ts";

await compile(paraglideOptions);

// a plugin that fails to load only warns and leaves the messages empty, so check every key made it
const keys = Object.keys(JSON.parse(readFileSync(new URL("./messages/en.json", import.meta.url), "utf8")));
const index = readFileSync(`${paraglideOptions.outdir}/messages/_index.js`, "utf8");
const missing = keys.filter((k) => k !== "$schema" && !index.includes(`'./${k}.js'`));
if (missing.length > 0) throw new Error(`messages missing from the compiled output: ${missing.slice(0, 5).join(", ")}`);
