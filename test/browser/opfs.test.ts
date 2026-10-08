import { expect, test } from "vitest";

test("OPFS sync access handles work in a worker", async () => {
  let main = "main ok";
  try {
    await navigator.storage.getDirectory();
  } catch (e) {
    main = `main: ${e instanceof Error ? `${e.name}: ${e.message}` : String(e)}`;
  }
  console.log(
    main,
    navigator.userAgent,
    isSecureContext,
    await navigator.storage
      .estimate()
      .then((x) => JSON.stringify(x))
      .catch(String),
  );
  const worker = new Worker(new URL("./opfs.worker.ts", import.meta.url), { type: "module" });
  const steps = await new Promise<string[]>((done) => {
    worker.onmessage = (e) => done(e.data);
    worker.postMessage("run");
  });
  worker.terminate();
  console.log(JSON.stringify(steps));
  expect(steps).toContain("sah ok");
});
