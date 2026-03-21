import { spawn } from "node:child_process";

export const DEFAULT_ENGINE_HOST = "127.0.0.1";

export function defaultPortForProtocol(protocol, fallbackPort) {
  if (protocol === "https:" || protocol === "wss:") return 443;
  if (protocol === "http:" || protocol === "ws:") return 80;
  return fallbackPort;
}

export function parseBaseUrl(raw, fallbackPort) {
  const configured = (raw ?? "").trim();
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

export function prefixOutput(stream, label, chunk) {
  const text = chunk.toString();
  const lines = text.split(/\r?\n/);
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    const isLast = index === lines.length - 1;
    if (line.length === 0 && isLast) continue;
    stream.write(`[${label}] ${line}${isLast ? "" : "\n"}`);
  }
}

export function spawnManagedProcess(children, label, command, env = {}) {
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

export function terminateChildren(children) {
  for (const child of children) {
    if (!child.killed) {
      child.kill("SIGINT");
    }
  }
}

export function wireTermination(children) {
  let shuttingDown = false;
  const shutdown = () => {
    if (shuttingDown) return;
    shuttingDown = true;
    terminateChildren(children);
  };
  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
  return shutdown;
}

export async function waitForChildren(children) {
  await Promise.all(
    children.map(
      (child) =>
        new Promise((resolve) => {
          child.once("exit", (code, signal) => {
            resolve({ code: code ?? 0, signal: signal ?? null });
          });
        }),
    ),
  );
}

export async function waitForJson(
  url,
  label,
  timeoutMs = 60_000,
  intervalMs = 500,
) {
  const startedAt = Date.now();
  for (;;) {
    try {
      const response = await fetch(url);
      if (response.ok) {
        return await response.json();
      }
    } catch {
      // retry until timeout
    }
    if (Date.now() - startedAt >= timeoutMs) {
      throw new Error(`[${label}] timed out waiting for ${url}`);
    }
    await new Promise((resolve) => setTimeout(resolve, intervalMs));
  }
}

export function printBlock(lines) {
  process.stdout.write(`${lines.join("\n")}\n`);
}

export function isTruthy(value) {
  return ["1", "true", "yes", "on"].includes(
    String(value ?? "")
      .trim()
      .toLowerCase(),
  );
}
