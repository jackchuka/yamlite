self.onmessage = async () => {
  const steps: string[] = [];
  try {
    const root = await navigator.storage.getDirectory();
    steps.push("getDirectory ok");
    const dir = await root.getDirectoryHandle("probe", { create: true });
    steps.push("dir ok");
    const fh = await dir.getFileHandle("f.bin", { create: true });
    steps.push("file ok");
    // oxlint-disable-next-line typescript/no-explicit-any
    const sah = await (fh as any).createSyncAccessHandle();
    steps.push("sah ok");
    sah.write(new Uint8Array([1, 2, 3]), { at: 0 });
    steps.push(`size ${sah.getSize()}`);
    sah.close();
  } catch (e) {
    steps.push(`error: ${e instanceof Error ? `${e.name}: ${e.message}` : String(e)}`);
  }
  postMessage(steps);
};
