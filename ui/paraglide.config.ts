import { fileURLToPath } from "node:url";
import type { CompilerOptions } from "@inlang/paraglide-js";

const here = (path: string) => fileURLToPath(new URL(path, import.meta.url));

export const paraglideOptions = {
  project: here("./project.inlang"),
  outdir: here("./src/paraglide"),
  strategy: ["custom-storage", "preferredLanguage", "baseLocale"],
  emitGitIgnore: false,
  emitPrettierIgnore: false,
  emitReadme: false,
} satisfies CompilerOptions;
