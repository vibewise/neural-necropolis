import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import {
  parseBaseUrl,
  printBlock,
  spawnManagedProcess,
  waitForJson,
  isTruthy,
} from "./demo-common.mjs";

const DEFAULT_ADMIN_TOKEN =
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.neural-necropolis-dev-admin.signature";

const fallbackPort = Number.parseInt(process.env.PORT ?? "3000", 10) || 3000;
const target = parseBaseUrl(
  process.env.NEURAL_NECROPOLIS_SERVER_URL,
  fallbackPort,
);
const basePort = target.port;
const host = process.env.HOST ?? target.host;
const duelCount = Number.parseInt(process.env.NN_BENCHMARK_DUELS ?? "10", 10);
const submitWindowMs =
  Number.parseInt(process.env.NN_BENCHMARK_SUBMIT_MS ?? "8000", 10) || 8000;
const resolveWindowMs =
  Number.parseInt(process.env.NN_BENCHMARK_RESOLVE_MS ?? "500", 10) || 500;
const completionTimeoutMs =
  Number.parseInt(process.env.NN_BENCHMARK_TIMEOUT_MS ?? "180000", 10) ||
  180000;
const seed =
  (process.env.DUNGEON_SEED ?? "benchmark-gpt4omini-vs-llama70").trim() ||
  "benchmark-gpt4omini-vs-llama70";
const slots = [
  (process.env.NN_BENCHMARK_SLOT_ONE ?? "D").trim().toUpperCase() || "D",
  (process.env.NN_BENCHMARK_SLOT_TWO ?? "A").trim().toUpperCase() || "A",
];
const outputFile = path.resolve(
  process.cwd(),
  process.env.NN_BENCHMARK_OUTPUT ??
    `tmp/llm-duel-benchmark-${Date.now().toString(36)}.json`,
);
const adminToken =
  (process.env.NEURAL_NECROPOLIS_ADMIN_TOKEN ?? "").trim() ||
  DEFAULT_ADMIN_TOKEN;
const dryRun = isTruthy(process.env.NN_BENCHMARK_DRY_RUN);

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function fetchJson(url, init = {}) {
  const response = await fetch(url, init);
  const text = await response.text();
  const body = text.trim() ? JSON.parse(text) : null;
  if (!response.ok) {
    throw new Error(
      `request to ${url} failed with ${response.status}: ${text || response.statusText}`,
    );
  }
  return body;
}

async function postJson(url, body) {
  return await fetchJson(url, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${adminToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });
}

async function waitForHeroCount(serverUrl, expectedCount, timeoutMs = 60000) {
  const startedAt = Date.now();
  for (;;) {
    const snapshot = await fetchJson(`${serverUrl}/api/dashboard`);
    if ((snapshot.heroes ?? []).length === expectedCount) {
      return snapshot;
    }
    if (Date.now() - startedAt >= timeoutMs) {
      throw new Error(
        `timed out waiting for ${expectedCount} heroes on ${serverUrl}`,
      );
    }
    await sleep(500);
  }
}

async function waitForCompletedBoard(serverUrl, boardId, timeoutMs) {
  const startedAt = Date.now();
  for (;;) {
    const payload = await fetchJson(
      `${serverUrl}/api/boards/completed?offset=0&limit=10`,
    );
    const match = (payload.boards ?? []).find(
      (board) => board.boardId === boardId,
    );
    if (match) {
      return match;
    }
    if (Date.now() - startedAt >= timeoutMs) {
      throw new Error(
        `timed out waiting for completed board ${boardId} on ${serverUrl}`,
      );
    }
    await sleep(1000);
  }
}

function slotForHero(heroName) {
  return slots.find((slot) => heroName.endsWith(`-${slot}`)) ?? null;
}

function heroPositions(snapshot) {
  return (snapshot.heroes ?? []).map((hero) => ({
    heroName: hero.name,
    slot: slotForHero(hero.name),
    position: hero.position,
  }));
}

async function stopChildren(children) {
  for (const child of children) {
    if (!child.killed) {
      child.kill("SIGINT");
    }
  }

  await Promise.all(
    children.map(
      (child) =>
        new Promise((resolve) => {
          const timeout = setTimeout(() => {
            if (!child.killed) {
              child.kill("SIGKILL");
            }
          }, 5000);
          child.once("exit", () => {
            clearTimeout(timeout);
            resolve();
          });
        }),
    ),
  );
}

async function runSingleDuel(duelIndex) {
  const duelPort = basePort + duelIndex;
  const serverUrl = `http://${host}:${duelPort}`;
  const registrationOrder =
    duelIndex % 2 === 0 ? [...slots] : [...slots].reverse();
  const children = [];

  try {
    spawnManagedProcess(
      children,
      `engine:${duelIndex + 1}`,
      "npm run run:engine",
      {
        HOST: host,
        PORT: String(duelPort),
        DUNGEON_SEED: seed,
        MAX_HEROES: "2",
        BEAT_PLANNING_MS: String(submitWindowMs),
        BEAT_ACTION_MS: String(resolveWindowMs),
      },
    );

    await waitForJson(
      `${serverUrl}/api/health`,
      `duel:${duelIndex + 1} server`,
    );

    for (let index = 0; index < registrationOrder.length; index += 1) {
      const slot = registrationOrder[index];
      spawnManagedProcess(
        children,
        `bot:${duelIndex + 1}:${slot}`,
        "npm run run:aibots:bot",
        {
          AIBOT_SLOT: slot,
          NEURAL_NECROPOLIS_SERVER_URL: serverUrl,
        },
      );
      await waitForHeroCount(serverUrl, index + 1);
      await sleep(250);
    }

    const readySnapshot = await waitForHeroCount(serverUrl, 2);
    const boardId = readySnapshot.boardId;
    await postJson(`${serverUrl}/api/admin/settings`, {
      paused: false,
      submitWindowMs,
      resolveWindowMs,
    });
    await postJson(`${serverUrl}/api/admin/start`, {});

    const completed = await waitForCompletedBoard(
      serverUrl,
      boardId,
      completionTimeoutMs,
    );

    return {
      duelIndex,
      serverUrl,
      boardId,
      seed: completed.seed,
      registrationOrder,
      initialPositions: heroPositions(readySnapshot),
      completionReason: completed.completionReason,
      turn: completed.turn,
      topLeaderboard: completed.topLeaderboard,
      winnerSlot: completed.topLeaderboard?.[0]?.heroName
        ? slotForHero(completed.topLeaderboard[0].heroName)
        : null,
    };
  } finally {
    await stopChildren(children);
  }
}

function buildAggregate(duels) {
  const aggregate = Object.fromEntries(
    slots.map((slot) => [slot, { wins: 0, totalScore: 0, duels: 0 }]),
  );

  for (const duel of duels) {
    for (const entry of duel.topLeaderboard ?? []) {
      const slot = slotForHero(entry.heroName);
      if (!slot) continue;
      aggregate[slot].duels += 1;
      aggregate[slot].totalScore += entry.totalScore;
    }
    if (duel.winnerSlot && aggregate[duel.winnerSlot]) {
      aggregate[duel.winnerSlot].wins += 1;
    }
  }

  return aggregate;
}

async function writeResults(payload) {
  await mkdir(path.dirname(outputFile), { recursive: true });
  await writeFile(outputFile, JSON.stringify(payload, null, 2));
}

async function main() {
  printBlock([
    "[benchmark:duel] starting provider-backed duel benchmark",
    `[benchmark:duel] slots ${slots.join(" vs ")}`,
    `[benchmark:duel] duel count ${duelCount}`,
    `[benchmark:duel] fixed seed ${seed}`,
    `[benchmark:duel] submit window ${submitWindowMs}ms`,
    `[benchmark:duel] resolve window ${resolveWindowMs}ms`,
    `[benchmark:duel] output ${outputFile}`,
  ]);

  if (dryRun) {
    printBlock([
      "[benchmark:duel] dry run enabled; no processes started",
      "[benchmark:duel] engine command: npm run run:engine",
      "[benchmark:duel] bot command: npm run run:aibots:bot",
      `[benchmark:duel] registration alternates between ${slots[0]} then ${slots[1]} and ${slots[1]} then ${slots[0]}`,
    ]);
    return;
  }

  const duels = [];
  for (let duelIndex = 0; duelIndex < duelCount; duelIndex += 1) {
    printBlock([
      "",
      `[benchmark:duel] duel ${duelIndex + 1}/${duelCount}`,
      `[benchmark:duel] registration order ${(duelIndex % 2 === 0 ? slots : [...slots].reverse()).join(" -> ")}`,
    ]);
    const duel = await runSingleDuel(duelIndex);
    duels.push(duel);
    const winner = duel.topLeaderboard?.[0];
    printBlock([
      `[benchmark:duel] completed board ${duel.boardId}`,
      `[benchmark:duel] winner ${winner?.heroName ?? "unknown"} (${winner?.totalScore ?? 0} pts)`,
      `[benchmark:duel] completion ${duel.completionReason}`,
    ]);
  }

  const payload = {
    createdAt: new Date().toISOString(),
    seed,
    slots,
    duelCount,
    submitWindowMs,
    resolveWindowMs,
    duels,
    aggregate: buildAggregate(duels),
  };
  await writeResults(payload);

  printBlock([
    "",
    `[benchmark:duel] benchmark complete`,
    `[benchmark:duel] results saved to ${outputFile}`,
    `[benchmark:duel] aggregate ${JSON.stringify(payload.aggregate)}`,
    "",
  ]);
}

main().catch((error) => {
  const message = error instanceof Error ? error.message : String(error);
  process.stderr.write(`[benchmark:duel] ${message}\n`);
  process.exitCode = 1;
});
