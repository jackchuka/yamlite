// the script of a host's page frame: writes the page document posted by the UI that framed it, once
let written = false;
if (window.parent !== window) {
  window.addEventListener("message", (e) => {
    const m = e.data as { yamlite?: unknown; document?: unknown } | null;
    if (written || e.source !== window.parent || m?.yamlite !== 1 || typeof m.document !== "string") return;
    written = true;
    document.open();
    document.write(m.document);
    document.close();
  });
}
