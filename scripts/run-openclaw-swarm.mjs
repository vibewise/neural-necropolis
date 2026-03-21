import { spawn } from "node:child_process";
import net from "node:net";

const MIN_COUNT = 1;
const MAX_COUNT = 10;
const DEFAULT_COUNT = 4;
const DEFAULT_OPENCLAW_PLANNING_MS = 30000;
const MIN_RECOMMENDED_PLANNING_MS = 25000;
const DEFAULT_ENGINE_HOST = "127.0.0.1";

const OPENCLAW_WORKERS = [
  { label: "oc1", session: "crypt-ash", persona: "scout" },
  { label: "oc2", session: "bone-cairn", persona: "raider" },
  { label: "oc3", session: "ember-vault", persona: "slayer" },
  { label: "oc4", session: "grave-moss", persona: "warden" },
  { label: "oc5", session: "mire-lantern", persona: "scout" },
  { label: "oc6", session: "tomb-spark", persona: "raider" },
  { label: "oc7", session: "cinder-hollow", persona: "slayer" },
  { label: "oc8", session: "ashen-gate", persona: "warden" },
  { label: "oc9", session: "dusk-warren", persona: "scout" },
  { label: "oc10", session: "gloom-keep", persona: "raider" },
];

function readServerUrl() {
  return (process.env.NEURAL_NECROPOLIS_SERVER_URL ?? "").trim();
}

function readAuthToken() {
  return (
    process.env.NEURAL_NECROPOLIS_PLAYER_TOKEN ??
    process.env.NEURAL_NECROPOLIS_AUTH_TOKEN ??
    ""
  ).trim();
}

function defaultPortForProtocol(protocol, fallbackPort) {
  if (protocol === "https:" || protocol === "wss:") return 443;
  if (protocol === "http:" || protocol === "ws:") return 80;
  return fallbackPort;
}

function parseBaseUrl(raw, fallbackPort) {
  const configured = (raw ?? "").trim();
  if (!configured) {
    return {
      explicit: false,
      host: DEFAULT_ENGINE_HOST,
      port: fallbackPort,
      protocol: "http:",
      baseUrl: `http://${DEFAULT_ENGINE_HOST}:${fallbackPort}`,
    };
  }
  const parsed = new URL(configured);
  return {
    explicit: true,
    host: parsed.hostname || DEFAULT_ENGINE_HOST,
    port: parsed.port
      ? Number.parseInt(parsed.port, 10)
      : defaultPortForProtocol(parsed.protocol, fallbackPort),
    protocol: parsed.protocol,
    baseUrl: parsed.toString().replace(/\/$/, ""),
  };
}

function probePort(host, port, timeoutMs = 750) {
  return new Promise((resolve) => {
    const socket = new net.Socket();
    let settled = false;
    const finish = (result) => {
      if (settled) return;
      settled = true;
      socket.destroy();
      resolve(result);
    };
    socket.setTimeout(timeoutMs);
    socket.once("connect", () => finish(true));
    socket.once("timeout", () => finish(false));
    socket.once("error", () => finish(false));
    socket.connect(port, host);
  });
}

async function fetchTurnState(baseUrl) {
  const headers = {};
  const authToken = readAuthToken();
  if (authToken) {
    headers.Authorization = `Bearer ${authToken}`;
  }
  const response = await fetch(`${baseUrl.replace(/\/$/, "")}/api/health`, {
    headers,
  });
  if (!response.ok) {
    throw new Error(`health check failed: ${response.status}`);
  }
  const data = await response.json();
  return data?.turnState ?? null;
}

function printUsage() {
  process.stderr.write(
    `Usage: npm run run:openclaw:agents -- <count>\nCount must be an integer from ${MIN_COUNT} to ${MAX_COUNT}. Default: ${DEFAULT_COUNT}.\n`,
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
  if (rawCount === undefined) return DEFAULT_COUNT;
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
    if (line.length === 0 && isLast) continue;
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
  const count = parseCount(process.argv.slice(2));
  const children = [];
  let exitCode = 0;
  let shuttingDown = false;
  const selectedWorkers = OPENCLAW_WORKERS.slice(0, count);
  const engineTarget = parseBaseUrl(
    readServerUrl(),
    Number.parseInt(process.env.PORT ?? "3000", 10) || 3000,
  );
  const engineBaseUrl = engineTarget.baseUrl;
  const gatewayTarget = {
    host: "127.0.0.1",
    port:
      Number.parseInt(process.env.OPENCLAW_GATEWAY_PORT ?? "18789", 10) ||
      18789,
  };
  process.stderr.write(
    `[run:openclaw:swarm] starting ${selectedWorkers.length} autonomous OpenClaw agent${selectedWorkers.length === 1 ? "" : "s"}\n`,
  );
  process.stderr.write(
    `[run:openclaw:swarm] target server ${engineBaseUrl}${engineTarget.explicit ? " (configured)" : " (local default)"}\n`,
  );

  const engineRunning = await probePort(engineTarget.host, engineTarget.port);
  if (engineRunning) {
    process.stderr.write(
      `[run:openclaw:swarm] reusing existing engine at ${engineBaseUrl}\n`,
    );
    const turnState = await fetchTurnState(engineBaseUrl);
    const submitWindowMs = Number(turnState?.submitWindowMs ?? 0);
    const allowShortWindows = ["1", "true", "yes", "on"].includes(
      (process.env.OPENCLAW_ALLOW_SHORT_WINDOWS ?? "").trim().toLowerCase(),
    );
    if (
      submitWindowMs > 0 &&
      submitWindowMs < MIN_RECOMMENDED_PLANNING_MS &&
      !allowShortWindows
    ) {
      throw new Error(
        `[run:openclaw:swarm] existing engine submit window is ${submitWindowMs}ms; OpenClaw needs at least ${MIN_RECOMMENDED_PLANNING_MS}ms here. Restart the engine yourself with BEAT_PLANNING_MS=${DEFAULT_OPENCLAW_PLANNING_MS}. Set OPENCLAW_ALLOW_SHORT_WINDOWS=1 to override.`,
      );
    }
  } else {
    throw new Error(
      `[run:openclaw:swarm] could not reach the server at ${engineBaseUrl}. Start the server separately with npm run run:engine.`,
    );
  }

  const gatewayRunning = await probePort(
    gatewayTarget.host,
    gatewayTarget.port,
  );
  if (gatewayRunning) {
    process.stderr.write(
      `[run:openclaw:swarm] reusing existing OpenClaw gateway at ws://${gatewayTarget.host}:${gatewayTarget.port}\n`,
    );
  } else {
    spawnManagedProcess(children, "gateway", "openclaw gateway run", {});
  }

  for (const worker of selectedWorkers) {
    const localFlag = ["1", "true", "yes", "on"].includes(
      (
        process.env.OPENCLAW_AGENT_LOCAL ??
        (process.platform === "win32" ? "1" : "")
      )
        .trim()
        .toLowerCase(),
    )
      ? " --local"
      : "";
    const command =
      `npm run run:openclaw:bot -- --session ${worker.session} --slug ${worker.session} ` +
      `--persona ${worker.persona}${localFlag}`;
    spawnManagedProcess(children, worker.label, command, {});
  }

  const waitForChildren = children.map(
    (child) =>
      new Promise((resolvePromise) => {
        child.on("exit", (code, signal) => {
          if (code && code !== 0 && exitCode === 0) exitCode = code;
          if (signal && exitCode === 0) exitCode = 1;
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
  printUsage();
  process.exitCode = 1;
});
