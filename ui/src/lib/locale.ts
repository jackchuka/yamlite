import { defineCustomClientStrategy } from "@/paraglide/runtime.js";

const KEY = "yamlite-locale";

// Paraglide's own localStorage strategy throws when the browser blocks storage, which would blank the page
defineCustomClientStrategy("custom-storage", {
  getLocale: () => {
    try {
      return localStorage.getItem(KEY) ?? undefined;
    } catch {
      return undefined;
    }
  },
  setLocale: (locale) => {
    try {
      localStorage.setItem(KEY, locale);
    } catch {
      // storage can be blocked; the choice then lasts until reload
    }
  },
});
