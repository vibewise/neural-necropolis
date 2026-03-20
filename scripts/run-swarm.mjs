import { spawn } from "node:child_process";

const MIN_COUNT = 2;
const MAX_COUNT = 10;
const DEFAULT_COUNT = 10;

const AI_SLOTS = ["A", "B", "C", "D", "E", "F", "G", "H", "I", "J"];

const MODE_CONFIG = {
  scripted: {
    engineEnv: {
      BEAT_PLANNING_MS: "3000",
      BEAT_ACTION_MS: "500",
    },
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
    engineEnv: {
      BEAT_PLANNING_MS: "8000",
      BEAT_ACTION_MS: "500",
    },
    entries: AI_SLOTS.map((slot) => ({
      label: `ai${slot.toLowerCase()}`,
      command: "npm run run:aibots:bot",
      env: { AIBOT_SLOT: slot },
    })),
  },
};

function printUsage(mode) {
  const scriptName = mode === "aibots" ? "run:aibots" : "run:scripted";
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

  const selectedEntries = config.entries.slice(0, count);
  process.stderr.write(
    `[run:${rawMode}] starting ${selectedEntries.length} bot${selectedEntries.length === 1 ? "" : "s"}\n`,
  );

  spawnManagedProcess(
    children,
    "engine",
    "npm run run:engine",
    config.engineEnv,
  );

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
