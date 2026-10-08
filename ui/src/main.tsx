import "./lib/locale";
import { createRoot } from "react-dom/client";
import { LoadFailure } from "./components/LoadFailure";
import { renderApp } from "./app";
import { setBackend } from "./lib/api";
import { enterStatic, isStaticPage } from "./lib/mode";
import { getLocale } from "./paraglide/runtime.js";
import "./styles.css";

async function boot() {
  const el = document.getElementById("root") as HTMLElement;
  if (isStaticPage()) {
    try {
      const { loadStatic } = await import("./lib/static/load");
      const { api, snapshot } = await loadStatic();
      setBackend(api);
      enterStatic(snapshot);
    } catch (e) {
      document.documentElement.lang = getLocale();
      createRoot(el).render(<LoadFailure error={e} />);
      return;
    }
  }
  renderApp(el);
}

void boot();
