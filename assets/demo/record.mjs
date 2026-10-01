// Renders index.html frame by frame in headless Chrome and encodes assets/demo.gif.
// Usage: node assets/demo/record.mjs   (needs Google Chrome and ffmpeg; set CHROME to override the path)
import { spawn, execFileSync } from "node:child_process";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const FPS = 15;
const WIDTH = 960;
const HEIGHT = 500;
const PORT = 9333;
const here = fileURLToPath(new URL(".", import.meta.url));
const out = join(here, "..", "demo.gif");
const chromePath = process.env.CHROME ?? "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";

const profile = mkdtempSync(join(tmpdir(), "yamlite-demo-"));
const chrome = spawn(chromePath, [
  "--headless=new",
  "--disable-gpu",
  "--hide-scrollbars",
  `--remote-debugging-port=${PORT}`,
  `--user-data-dir=${profile}`,
  `--window-size=${WIDTH},${HEIGHT}`,
  "about:blank",
]);

try {
  const target = await waitForTarget();
  const cdp = await connect(target.webSocketDebuggerUrl);
  await cdp("Emulation.setDeviceMetricsOverride", {
    width: WIDTH,
    height: HEIGHT,
    deviceScaleFactor: 1,
    mobile: false,
  });
  await cdp("Page.enable");
  await cdp("Page.navigate", { url: pathToFileURL(join(here, "index.html")).href });
  const evaluate = async (expression) =>
    (await cdp("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true })).result.value;
  while ((await evaluate("document.readyState")) !== "complete") await sleep(50);
  await evaluate("document.fonts.ready.then(() => true)");
  const duration = await evaluate("window.DURATION");

  const frames = mkdtempSync(join(tmpdir(), "yamlite-frames-"));
  const count = Math.ceil((duration / 1000) * FPS);
  for (let i = 0; i < count; i++) {
    await evaluate(`render(${(i * 1000) / FPS})`);
    const { data } = await cdp("Page.captureScreenshot", { format: "png" });
    writeFileSync(join(frames, `${String(i).padStart(4, "0")}.png`), Buffer.from(data, "base64"));
  }

  execFileSync("ffmpeg", [
    "-v",
    "error",
    "-y",
    "-framerate",
    String(FPS),
    "-i",
    join(frames, "%04d.png"),
    "-vf",
    "split[a][b];[a]palettegen=stats_mode=diff[p];[b][p]paletteuse=dither=none:diff_mode=rectangle",
    "-loop",
    "0",
    out,
  ]);
  rmSync(frames, { recursive: true, force: true });
  console.log(`wrote ${out} (${count} frames)`);
} finally {
  const exited = new Promise((r) => chrome.once("exit", r));
  chrome.kill();
  await exited;
  rmSync(profile, { recursive: true, force: true, maxRetries: 5 });
}

async function waitForTarget() {
  for (let i = 0; i < 100; i++) {
    try {
      const pages = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json();
      const page = pages.find((p) => p.type === "page");
      if (page) return page;
    } catch {}
    await sleep(100);
  }
  throw new Error("Chrome did not start");
}

async function connect(url) {
  const ws = new WebSocket(url);
  await new Promise((resolve, reject) => {
    ws.onopen = resolve;
    ws.onerror = reject;
  });
  let id = 0;
  const pending = new Map();
  ws.onmessage = ({ data }) => {
    const msg = JSON.parse(data);
    const p = pending.get(msg.id);
    if (!p) return;
    pending.delete(msg.id);
    if (msg.error) p.reject(new Error(msg.error.message));
    else p.resolve(msg.result);
  };
  return (method, params = {}) =>
    new Promise((resolve, reject) => {
      pending.set(++id, { resolve, reject });
      ws.send(JSON.stringify({ id, method, params }));
    });
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}
