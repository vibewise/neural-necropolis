import { createServer } from "node:http";
import { readFile, stat } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const moduleDir = path.dirname(fileURLToPath(import.meta.url));
const publicDir = path.join(moduleDir, "public");

const MIME_TYPES = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".png": "image/png",
  ".svg": "image/svg+xml",
  ".txt": "text/plain; charset=utf-8",
};

export async function startStaticDashboardServer(options = {}) {
  const host = options.host ?? process.env.DASHBOARD_STATIC_HOST ?? "127.0.0.1";
  const port = normalizePort(
    options.port ?? process.env.DASHBOARD_STATIC_PORT ?? "4173",
  );

  const server = createServer(async (req, res) => {
    try {
      const requestUrl = new URL(
        req.url ?? "/",
        `http://${req.headers.host ?? `${host}:${port}`}`,
      );
      let relativePath = decodeURIComponent(requestUrl.pathname);
      if (relativePath === "/") {
        relativePath = "/index.html";
      }
      const filePath = safeJoin(publicDir, relativePath);
      await stat(filePath);
      const ext = path.extname(filePath).toLowerCase();
      const content = await readFile(filePath);
      res.writeHead(200, {
        "Content-Type": MIME_TYPES[ext] ?? "application/octet-stream",
        "Cache-Control": "no-store",
      });
      res.end(content);
    } catch (error) {
      res.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
      res.end(error instanceof Error ? error.message : String(error));
    }
  });

  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(port, host, () => resolve());
  });

  const address = server.address();
  if (!address || typeof address === "string") {
    throw new Error("Unexpected static server address");
  }

  return {
    server,
    host: address.address,
    port: address.port,
    origin: `http://${address.address}:${address.port}`,
  };
}

function normalizePort(value) {
  const parsed = Number.parseInt(String(value), 10);
  if (!Number.isFinite(parsed) || parsed < 0) {
    return 4173;
  }
  return parsed;
}

function safeJoin(rootDir, relativePath) {
  const candidate = path.normalize(path.join(rootDir, relativePath));
  if (!candidate.startsWith(rootDir)) {
    throw new Error("Refusing to serve path outside public directory");
  }
  return candidate;
}
