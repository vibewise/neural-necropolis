import assert from "node:assert/strict";

import { startStaticDashboardServer } from "./static-server.mjs";

const targetServer = resolveTargetServer();
const staticServer = await startStaticDashboardServer({ port: 0 });

try {
  await assertServerReachable(targetServer);
  await assertDashboardContract(targetServer, staticServer.origin);
  await assertStandaloneHost(staticServer.origin, targetServer);

  console.log(`[dashboard-static] smoke passed`);
  console.log(`[dashboard-static] target server: ${targetServer}`);
  console.log(
    `[dashboard-static] standalone url: ${staticServer.origin}/?server=${encodeURIComponent(targetServer)}`,
  );
} finally {
  await new Promise((resolve, reject) => {
    staticServer.server.close((error) => {
      if (error) {
        reject(error);
        return;
      }
      resolve();
    });
  });
}

function resolveTargetServer() {
  const args = process.argv.slice(2);
  for (let index = 0; index < args.length; index += 1) {
    const token = args[index];
    if (token === "--server") {
      return normalizeUrl(args[index + 1] ?? "");
    }
    if (token.startsWith("--server=")) {
      return normalizeUrl(token.slice("--server=".length));
    }
  }

  return normalizeUrl(
    process.env.DASHBOARD_SMOKE_SERVER_URL ??
      process.env.NEURAL_NECROPOLIS_SERVER_URL ??
      "http://127.0.0.1:3000",
  );
}

function normalizeUrl(value) {
  const raw = String(value || "").trim();
  if (!raw) {
    return "http://127.0.0.1:3000";
  }
  return raw.replace(/\/+$/, "");
}

async function assertServerReachable(baseUrl) {
  const response = await fetch(`${baseUrl}/api/health`);
  assert.equal(response.ok, true, `expected ${baseUrl}/api/health to succeed`);
  const payload = await response.json();
  assert.equal(payload.ok, true, "health payload should report ok=true");
}

async function assertDashboardContract(baseUrl, origin) {
  const dashboardResponse = await fetch(`${baseUrl}/api/dashboard`);
  assert.equal(
    dashboardResponse.ok,
    true,
    `expected ${baseUrl}/api/dashboard to succeed`,
  );

  const preflight = await fetch(`${baseUrl}/api/admin/settings`, {
    method: "OPTIONS",
    headers: {
      Origin: origin,
      "Access-Control-Request-Method": "POST",
      "Access-Control-Request-Headers": "Authorization, Content-Type",
    },
  });
  assert.equal(
    preflight.status,
    204,
    "expected cross-origin admin preflight to return 204",
  );
  assert.equal(preflight.headers.get("access-control-allow-origin"), "*");
  assert.match(
    preflight.headers.get("access-control-allow-headers") ?? "",
    /Authorization/,
  );
  assert.match(
    preflight.headers.get("access-control-allow-headers") ?? "",
    /Content-Type/,
  );
}

async function assertStandaloneHost(staticOrigin, targetServer) {
  const response = await fetch(
    `${staticOrigin}/?server=${encodeURIComponent(targetServer)}`,
  );
  assert.equal(
    response.ok,
    true,
    "expected standalone dashboard host to serve index.html",
  );
  const html = await response.text();
  assert.match(html, /Neural Necropolis/);
  assert.match(html, /Dashboard API Server/);
  assert.match(html, /apiBase/);
}
