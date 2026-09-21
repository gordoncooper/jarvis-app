// Bastion-only headless UI driver (AGENTS.md permits glass dev tooling; this is
// never in the image). Loads a display, runs a script of real input events
// through CDP, screenshots, and reports console errors.
//
//   node tools/drive.mjs <url> <out.png> '<json actions>'
//
// actions: {wait:ms} {click:"sel"} {at:[x,y]} {type:["sel","text"]} {key:"Enter",code:13}
//          {hold:["Space",ms]} — keydown, wait, keyup (push-to-talk)
//          {drag:["sel",dx,dy]} {eval:"expr"} {shot:"file.png"}
//
// Static screenshots miss interaction bugs. Two real ones were only found this
// way: Login's unguarded window Enter handler slid the deck to Earth whenever a
// turn was sent from CMD or NOC, and the deck's swipe test ate the globe drag.
const [url, out, actionsJson] = process.argv.slice(2);
const actions = JSON.parse(actionsJson || "[]");
const PORT = 9333 + Math.floor(Math.random() * 400);
// Viewport override, for checking layouts that depend on container height.
const VW = Number(process.env.VW || 1920);
const VH = Number(process.env.VH || 1080);
const { spawn } = await import("node:child_process");
const { writeFileSync, mkdtempSync, rmSync, readdirSync, statSync } = await import("node:fs");
const { tmpdir } = await import("node:os");
const { join } = await import("node:path");

// Sweep profiles from runs that were killed before they could clean up.
// Without this, aborted runs accumulate ~56MB each until /tmp fills and the
// next launch dies with "chrome did not come up".
for (const name of readdirSync(tmpdir())) {
  if (!name.startsWith("cdp-")) continue;
  const dir = join(tmpdir(), name);
  try {
    if (Date.now() - statSync(dir).mtimeMs > 30 * 60_000) rmSync(dir, { recursive: true, force: true });
  } catch {}
}

const profile = mkdtempSync(join(tmpdir(), "cdp-"));
const chrome = spawn("google-chrome", [
  "--headless=new", "--no-sandbox", "--disable-dev-shm-usage",
  `--user-data-dir=${profile}`, "--hide-scrollbars", "--ignore-certificate-errors",
  "--use-gl=angle", "--use-angle=swiftshader", "--enable-unsafe-swiftshader",
  "--force-device-scale-factor=1", `--window-size=${VW},${VH}`,
  // FAKE_MEDIA=1 auto-grants the mic and feeds a synthetic audio track, so the
  // real push-to-talk path can be exercised headlessly. Off by default, or it
  // would mask a genuine permission-denied state.
  ...(process.env.FAKE_MEDIA === "1"
    ? ["--use-fake-ui-for-media-stream", "--use-fake-device-for-media-stream"]
    : []),
  `--remote-debugging-port=${PORT}`, "about:blank",
], { stdio: "ignore" });


// Each run leaves a ~56MB Chrome profile behind. Fifty aborted runs filled
// /tmp and the next launch failed with "chrome did not come up", so cleanup
// has to survive throws, timeouts and Ctrl-C — not just the happy path.
let cleanedUp = false;
function cleanup() {
  if (cleanedUp) return;
  cleanedUp = true;
  try { chrome.kill("SIGKILL"); } catch {}
  try { rmSync(profile, { recursive: true, force: true }); } catch {}
}

async function cleanupAndWait() {
  if (cleanedUp) return;
  const exited = new Promise((r) => chrome.once("exit", r));
  try { chrome.kill("SIGKILL"); } catch {}
  await Promise.race([exited, sleep(3000)]);
  cleanedUp = true;
  try { rmSync(profile, { recursive: true, force: true }); } catch {}
}
process.on("exit", cleanup);
for (const sig of ["SIGINT", "SIGTERM", "SIGHUP"]) process.on(sig, () => { cleanup(); process.exit(130); });
process.on("uncaughtException", (e) => { cleanup(); console.error(e); process.exit(1); });
process.on("unhandledRejection", (e) => { cleanup(); console.error(e); process.exit(1); });

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let ws, id = 0;
const pending = new Map();

async function connect() {
  for (let i = 0; i < 60; i++) {
    try {
      const r = await fetch(`http://127.0.0.1:${PORT}/json/list`);
      const tabs = await r.json();
      const page = tabs.find((t) => t.type === "page");
      if (page) return page.webSocketDebuggerUrl;
    } catch {}
    await sleep(250);
  }
  throw new Error("chrome did not come up");
}

function send(method, params = {}) {
  const msg = { id: ++id, method, params };
  ws.send(JSON.stringify(msg));
  return new Promise((res, rej) => {
    pending.set(msg.id, { res, rej });
    setTimeout(() => pending.has(msg.id) && rej(new Error(`timeout ${method}`)), 30000);
  });
}

const wsUrl = await connect();
ws = new WebSocket(wsUrl);
await new Promise((r) => (ws.onopen = r));
ws.onmessage = (ev) => {
  const m = JSON.parse(ev.data);
  if (m.id && pending.has(m.id)) {
    const { res, rej } = pending.get(m.id);
    pending.delete(m.id);
    m.error ? rej(new Error(JSON.stringify(m.error))) : res(m.result);
  }
};

await send("Emulation.setDeviceMetricsOverride", { width: VW, height: VH, deviceScaleFactor: 1, mobile: false });
await send("Page.enable");
await send("Runtime.enable");
const logs = [];
ws.addEventListener("message", (ev) => {
  const m = JSON.parse(ev.data);
  if (m.method === "Runtime.consoleAPICalled" && ["error", "warning"].includes(m.params.type))
    logs.push(`${m.params.type}: ${m.params.args.map((a) => a.value ?? a.description).join(" ")}`);
  if (m.method === "Runtime.exceptionThrown")
    logs.push(`exception: ${m.params.exceptionDetails.text} ${m.params.exceptionDetails.exception?.description ?? ""}`);
});

await send("Page.navigate", { url });
await sleep(3500);

async function rect(sel) {
  const r = await send("Runtime.evaluate", {
    expression: `(()=>{const e=document.querySelector(${JSON.stringify(sel)});if(!e)return null;const b=e.getBoundingClientRect();return JSON.stringify({x:b.x+b.width/2,y:b.y+b.height/2});})()`,
    returnByValue: true,
  });
  return r.result.value ? JSON.parse(r.result.value) : null;
}

async function shot(file) {
  const r = await send("Page.captureScreenshot", { format: "png" });
  writeFileSync(file, Buffer.from(r.data, "base64"));
  console.log("shot", file);
}

for (const a of actions) {
  if (a.wait) await sleep(a.wait);
  if (a.eval) {
    const r = await send("Runtime.evaluate", { expression: a.eval, returnByValue: true, awaitPromise: true });
    console.log("eval", a.eval, "=>", JSON.stringify(r.result.value ?? r.result.description));
  }
  if (a.hold) {
    const [key, ms] = a.hold;
    const k = key === "Space" ? " " : key;
    await send("Input.dispatchKeyEvent", { type: "rawKeyDown", key: k, code: key, windowsVirtualKeyCode: 32 });
    // Real keyboards autorepeat while held; replay that so the guard is tested.
    for (let t = 0; t < ms; t += 120) {
      await sleep(120);
      await send("Input.dispatchKeyEvent", { type: "rawKeyDown", key: k, code: key, windowsVirtualKeyCode: 32, autoRepeat: true });
    }
    await send("Input.dispatchKeyEvent", { type: "keyUp", key: k, code: key, windowsVirtualKeyCode: 32 });
    await sleep(300);
  }
  if (a.key) {
    // Enter needs text/\r or the form never submits.
    const extra = a.key === "Enter" ? { text: "\r", unmodifiedText: "\r" } : {};
    await send("Input.dispatchKeyEvent", { type: "keyDown", key: a.key, code: a.key, windowsVirtualKeyCode: a.code ?? 39, ...extra });
    await send("Input.dispatchKeyEvent", { type: "keyUp", key: a.key, code: a.key, windowsVirtualKeyCode: a.code ?? 39 });
    await sleep(500);
  }
  if (a.at) {
    const [x, y] = a.at;
    for (const type of ["mousePressed", "mouseReleased"])
      await send("Input.dispatchMouseEvent", { type, x, y, button: "left", clickCount: 1 });
    await sleep(400);
  }
  if (a.click) {
    const p = await rect(a.click);
    if (!p) { console.log("MISSING", a.click); continue; }
    for (const type of ["mousePressed", "mouseReleased"])
      await send("Input.dispatchMouseEvent", { type, x: p.x, y: p.y, button: "left", clickCount: 1 });
    await sleep(400);
  }
  if (a.type) {
    const [sel, text] = a.type;
    const p = await rect(sel);
    if (p) for (const type of ["mousePressed", "mouseReleased"])
      await send("Input.dispatchMouseEvent", { type, x: p.x, y: p.y, button: "left", clickCount: 1 });
    for (const ch of text) await send("Input.dispatchKeyEvent", { type: "char", text: ch });
    await sleep(200);
  }
  if (a.drag) {
    const [sel, dx, dy] = a.drag;
    const p = await rect(sel);
    if (p) {
      await send("Input.dispatchMouseEvent", { type: "mousePressed", x: p.x, y: p.y, button: "left", clickCount: 1 });
      for (let i = 1; i <= 8; i++)
        await send("Input.dispatchMouseEvent", { type: "mouseMoved", x: p.x + (dx * i) / 8, y: p.y + (dy * i) / 8, button: "left" });
      await send("Input.dispatchMouseEvent", { type: "mouseReleased", x: p.x + dx, y: p.y + dy, button: "left" });
      await sleep(600);
    }
  }
  if (a.shot) await shot(a.shot);
}

if (out) await shot(out);
if (logs.length) { console.log("--- console ---"); logs.slice(0, 30).forEach((l) => console.log(l)); }
else console.log("--- console clean ---");
await cleanupAndWait();
process.exit(0);
