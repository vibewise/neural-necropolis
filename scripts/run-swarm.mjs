import { spawn } from "node:child_process";

const DEFAULT_ENGINE_HOST = "127.0.0.1";
const DEFAULT_DEV_ADMIN_TOKEN =
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.neural-necropolis-dev-admin.signature";
const DEFAULT_SCRIPTED_SUBMIT_WINDOW_MS = 2000;

const MIN_COUNT = 1;
const MAX_COUNT = 10;
const DEFAULT_COUNT = 10;

const AI_SLOTS = ["A", "B", "C", "D", "E", "F", "G", "H", "I", "J"];

const MODE_CONFIG = {
  scripted: {
    entries: [
      {
        label: "b1",
        command: "npm run run:scripted:bot:berserker",
        env: { BOT_SLOT: "B1" },
      },
      {
        label: "e1",
        command: "npm run run:scripted:bot:explorer",
        env: { BOT_SLOT: "E1" },
      },
      {
        label: "t1",
        command: "npm run run:scripted:bot:treasure",
        env: { BOT_SLOT: "T1" },
      },
      {
        label: "b2",
        command: "npm run run:scripted:bot:berserker",
        env: { BOT_SLOT: "B2" },
      },
      {
        label: "e2",
        command: "npm run run:scripted:bot:explorer",
        env: { BOT_SLOT: "E2" },
      },
      {
        label: "t2",
        command: "npm run run:scripted:bot:treasure",
        env: { BOT_SLOT: "T2" },
      },
      {
        label: "b3",
        command: "npm run run:scripted:bot:berserker",
        env: { BOT_SLOT: "B3" },
      },
      {
        label: "e3",
        command: "npm run run:scripted:bot:explorer",
        env: { BOT_SLOT: "E3" },
      },
      {
        label: "b4",
        command: "npm run run:scripted:bot:berserker",
        env: { BOT_SLOT: "B4" },
      },
      {
        label: "t3",
        command: "npm run run:scripted:bot:treasure",
        env: { BOT_SLOT: "T3" },
      },
    ],
  },
  aibots: {
    entries: AI_SLOTS.map((slot) => ({
      label: `ai${slot.toLowerCase()}`,
      command: "npm run run:aibots:bot",
      env: { AIBOT_SLOT: slot },
    })),
  },
};

function readServerUrl() {
  return (process.env.NEURAL_NECROPOLIS_SERVER_URL ?? "").trim();
}

function defaultPortForProtocol(protocol, fallbackPort) {
  if (protocol === "https:" || protocol === "wss:") return 443;
  if (protocol === "http:" || protocol === "ws:") return 80;
  return fallbackPort;
}

function parseEngineTarget(raw, fallbackPort) {
  const configured = raw.trim();
  if (!configured) {
    return {
      explicit: false,
      protocol: "http:",
      host: DEFAULT_ENGINE_HOST,
      port: fallbackPort,
      baseUrl: `http://${DEFAULT_ENGINE_HOST}:${fallbackPort}`,
    };
  }

  const parsed = new URL(configured);
  const port = parsed.port
    ? Number.parseInt(parsed.port, 10)
    : defaultPortForProtocol(parsed.protocol, fallbackPort);
  return {
    explicit: true,
    protocol: parsed.protocol,
    host: parsed.hostname || DEFAULT_ENGINE_HOST,
    port,
    baseUrl: parsed.toString().replace(/\/$/, ""),
  };
}

async function ensureServerReachable(baseUrl) {
  const response = await fetch(`${baseUrl.replace(/\/$/, "")}/api/health`);
  if (!response.ok) {
    throw new Error(
      `[agents] server at ${baseUrl} responded with ${response.status}. Start the server separately with npm run run:engine.`,
    );
  }
}

function resolveAdminToken() {
  const configured =
    (process.env.NEURAL_NECROPOLIS_ADMIN_TOKEN ?? "").trim() ||
    (process.env.NEURAL_NECROPOLIS_AUTH_TOKEN ?? "").trim();
  return configured || DEFAULT_DEV_ADMIN_TOKEN;
}

function scriptedSubmitWindowMs() {
  const raw = (process.env.SCRIPTED_SUBMIT_WINDOW_MS ?? "").trim();
  if (!raw) {
    return DEFAULT_SCRIPTED_SUBMIT_WINDOW_MS;
  }

  const parsed = Number.parseInt(raw, 10);
  if (!Number.isFinite(parsed) || parsed < 250) {
    return DEFAULT_SCRIPTED_SUBMIT_WINDOW_MS;
  }
  return parsed;
}

async function configureScriptedServer(baseUrl) {
  const adminToken = resolveAdminToken();
  const desiredSubmitWindowMs = scriptedSubmitWindowMs();

  let settings;
  try {
    const response = await fetch(`${baseUrl}/api/admin/settings`, {
      headers: {
        Authorization: `Bearer ${adminToken}`,
      },
    });
    if (!response.ok) {
      process.stderr.write(
        `[run:scripted] unable to read admin settings (${response.status}); leaving server timing unchanged\n`,
      );
      return;
    }
    settings = await response.json();
  } catch (error) {
    process.stderr.write(
      `[run:scripted] unable to read admin settings: ${error instanceof Error ? error.message : String(error)}\n`,
    );
    return;
  }

  if ((settings.submitWindowMs ?? 0) === desiredSubmitWindowMs) {
    process.stderr.write(
      `[run:scripted] submit window already ${desiredSubmitWindowMs}ms\n`,
    );
    return;
  }

  const response = await fetch(`${baseUrl}/api/admin/settings`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${adminToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      includeLandmarks: Boolean(settings.includeLandmarks),
      includePlayerPositions: Boolean(settings.includePlayerPositions),
      paused: Boolean(settings.paused),
      submitWindowMs: desiredSubmitWindowMs,
      resolveWindowMs:
        Number.isFinite(settings.resolveWindowMs) &&
        settings.resolveWindowMs >= 50
          ? settings.resolveWindowMs
          : 500,
    }),
  });

  if (!response.ok) {
    process.stderr.write(
      `[run:scripted] unable to set submit window to ${desiredSubmitWindowMs}ms (${response.status}); leaving server timing unchanged\n`,
    );
    return;
  }

  process.stderr.write(
    `[run:scripted] configured submit window to ${desiredSubmitWindowMs}ms\n`,
  );
}

function printUsage(mode) {
  const scriptName =
    mode === "aibots" ? "run:aibots:agents" : "run:scripted:agents";
  process.stderr.write(
    `Usage: npm run ${scriptName} -- <count>\nCount must be an integer from ${MIN_COUNT} to ${MAX_COUNT}. Default: ${DEFAULT_COUNT}.\n`,
  );
}

function parseCount(argv) {
  let rawCount;

  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (token === "--count") {
      rawCount = argv[index + 1];
      index += 1;
      continue;
    }
    if (token.startsWith("--count=")) {
      rawCount = token.slice("--count=".length);
      continue;
    }
    if (!token.startsWith("--") && rawCount === undefined) {
      rawCount = token;
      continue;
    }
    throw new Error(`Unexpected argument: ${token}`);
  }

  if (rawCount === undefined) {
    return DEFAULT_COUNT;
  }

  const parsed = Number.parseInt(rawCount, 10);
  if (
    !Number.isFinite(parsed) ||
    String(parsed) !== rawCount.trim() ||
    parsed < MIN_COUNT ||
    parsed > MAX_COUNT
  ) {
    throw new Error(
      `Invalid bot count: ${rawCount}. Expected an integer from ${MIN_COUNT} to ${MAX_COUNT}.`,
    );
  }

  return parsed;
}

function prefixOutput(stream, label, chunk) {
  const text = chunk.toString();
  const lines = text.split(/\r?\n/);
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    const isLast = index === lines.length - 1;
    if (line.length === 0 && isLast) {
      continue;
    }
    stream.write(`[${label}] ${line}${isLast ? "" : "\n"}`);
  }
}

function spawnManagedProcess(children, label, command, env) {
  const child = spawn(command, {
    shell: true,
    stdio: ["inherit", "pipe", "pipe"],
    env: {
      ...process.env,
      ...env,
    },
  });
  children.push(child);

  child.stdout.on("data", (chunk) => {
    prefixOutput(process.stdout, label, chunk);
  });

  child.stderr.on("data", (chunk) => {
    prefixOutput(process.stderr, label, chunk);
  });

  return child;
}

function terminateChildren(children) {
  for (const child of children) {
    if (!child.killed) {
      child.kill("SIGINT");
    }
  }
}

async function main() {
  const [, , rawMode, ...rest] = process.argv;
  if (rawMode !== "scripted" && rawMode !== "aibots") {
    throw new Error(`Unsupported swarm mode: ${rawMode ?? "<missing>"}`);
  }

  const count = parseCount(rest);
  const config = MODE_CONFIG[rawMode];
  const children = [];
  let exitCode = 0;
  let shuttingDown = false;
  const fallbackPort = Number.parseInt(process.env.PORT ?? "3000", 10) || 3000;
  const engineTarget = parseEngineTarget(readServerUrl(), fallbackPort);

  const selectedEntries = config.entries.slice(0, count);
  process.stderr.write(
    `[run:${rawMode}] starting ${selectedEntries.length} bot${selectedEntries.length === 1 ? "" : "s"}\n`,
  );
  process.stderr.write(
    `[run:${rawMode}] target server ${engineTarget.baseUrl}${engineTarget.explicit ? " (configured)" : " (local default)"}\n`,
  );
  process.stderr.write(
    `[run:${rawMode}] server startup is intentionally separate from agent startup\n`,
  );

  await ensureServerReachable(engineTarget.baseUrl);

  if (rawMode === "scripted") {
    await configureScriptedServer(engineTarget.baseUrl);
  }

  for (const entry of selectedEntries) {
    spawnManagedProcess(children, entry.label, entry.command, entry.env);
  }

  const waitForChildren = children.map(
    (child) =>
      new Promise((resolvePromise) => {
        child.on("exit", (code, signal) => {
          if (code && code !== 0 && exitCode === 0) {
            exitCode = code;
          }
          if (signal && exitCode === 0) {
            exitCode = 1;
          }
          if (!shuttingDown) {
            shuttingDown = true;
            terminateChildren(children);
          }
          resolvePromise();
        });
      }),
  );

  process.on("SIGINT", () => {
    if (!shuttingDown) {
      shuttingDown = true;
      terminateChildren(children);
    }
  });

  process.on("SIGTERM", () => {
    if (!shuttingDown) {
      shuttingDown = true;
      terminateChildren(children);
    }
  });

  await Promise.all(waitForChildren);
  process.exitCode = exitCode;
}

main().catch((error) => {
  process.stderr.write(
    `${error instanceof Error ? error.message : String(error)}\n`,
  );
  const mode = process.argv[2];
  if (mode === "scripted" || mode === "aibots") {
    printUsage(mode);
  }
  process.exitCode = 1;
});
