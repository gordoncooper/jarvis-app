// Bastion-only glass dev server (AGENTS.md allows this; it is never in the image).
// Serves glass/dist and proxies /health, /readyz, /v1/* to a live orchestrator so
// screenshots of http://127.0.0.1:<port>/#noc show real /v1/pulse data.
//
//   kubectl -n apps port-forward svc/jarvis-orchestrator 18080:8080 &
//   node devserve.mjs              # http://127.0.0.1:5173
//
// Env: PORT (5173), ORCH (http://127.0.0.1:18080)
import { createServer, request as httpRequest } from "node:http";
import { createReadStream, existsSync, statSync } from "node:fs";
import { dirname, extname, join, normalize } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "dist");
const port = Number(process.env.PORT || 5173);
const orch = new URL(process.env.ORCH || "http://127.0.0.1:18080");

const TYPES = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".map": "application/json",
  ".json": "application/json",
  ".woff2": "font/woff2",
  ".jpg": "image/jpeg",
  ".png": "image/png",
  ".svg": "image/svg+xml",
};

const isProxied = (p) => p === "/health" || p === "/readyz" || p.startsWith("/v1/");

function proxy(req, res) {
  const up = httpRequest(
    {
      hostname: orch.hostname,
      port: orch.port,
      path: req.url,
      method: req.method,
      headers: { ...req.headers, host: orch.host },
    },
    (r) => {
      res.writeHead(r.statusCode || 502, r.headers);
      r.pipe(res);
    },
  );
  up.on("error", (e) => {
    res.writeHead(502, { "content-type": "application/json" });
    res.end(JSON.stringify({ error: "orchestrator unreachable", detail: String(e) }));
  });
  req.pipe(up);
}

function serve(res, file) {
  res.writeHead(200, {
    "content-type": TYPES[extname(file)] || "application/octet-stream",
    "cache-control": "no-store",
  });
  createReadStream(file).pipe(res);
}

createServer((req, res) => {
  const path = decodeURIComponent((req.url || "/").split("?")[0]);
  if (isProxied(path)) return proxy(req, res);
  const rel = normalize(path).replace(/^(\.\.[/\\])+/, "");
  const file = join(root, rel);
  if (file.startsWith(root) && existsSync(file) && statSync(file).isFile()) return serve(res, file);
  const index = join(root, "index.html");
  if (existsSync(index)) return serve(res, index);
  res.writeHead(404).end("no dist/ — run `npm run build` first");
}).listen(port, "127.0.0.1", () => {
  console.log(`glass dev  http://127.0.0.1:${port}   /v1 -> ${orch.origin}`);
});
