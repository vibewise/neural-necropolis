import "dotenv/config";
import path from "node:path";
import Fastify from "fastify";
import { dashboardHtml } from "./dashboard.js";
import { HeroCapacityError, WorldStore } from "./store.js";
import type {
  DashboardSnapshot,
  HeroAction,
  HeroRegistration,
  StreamEnvelope,
  TurnPhase,
  TurnState,
} from "../types.js";

const port = Number(process.env.PORT ?? 3000);
const planningMs = Number(process.env.BEAT_PLANNING_MS ?? 12_000);
const actionMs = Number(process.env.BEAT_ACTION_MS ?? 6_000);
const seed = process.env.DUNGEON_SEED ?? `dungeon-${Date.now()}`;
const maxHeroes = Number(process.env.MAX_HEROES ?? 0);
const expectedHeroes = Number(process.env.EXPECTED_HEROES ?? maxHeroes ?? 0);
const resetOnBoot = process.env.RESET_ON_BOOT === "1";

const store = new WorldStore(
  path.resolve(process.cwd(), "data", "world-state.json"),
  seed,
  maxHeroes,
);
const app = Fastify({
  logger: { level: process.env.LOG_LEVEL ?? "info" },
  disableRequestLogging: true,
});
const streamClients = new Set<{ reply: any }>();

/* ── Turn phase state machine ── */
type WorldLifecycle = "lobby" | "running" | "completed";

let turnPhase: TurnPhase = "submit";
let phaseStartedAt = Date.now();
let phaseEndsAt = Date.now() + planningMs;
let phaseTimer: ReturnType<typeof setTimeout> | null = null;
let worldStatus: WorldLifecycle = "lobby";
let completionReason: string | undefined;

function createSeed(): string {
  return `dungeon-${Date.now()}`;
}

function stopBeatLoop(): void {
  if (phaseTimer) {
    clearTimeout(phaseTimer);
    phaseTimer = null;
  }
}

function resetBeatLoop(): void {
  stopBeatLoop();
  turnPhase = "submit";
  phaseStartedAt = Date.now();
  phaseEndsAt = Date.now() + planningMs;
}

function startWorldLoop(): void {
  stopBeatLoop();
  turnPhase = "submit";
  phaseStartedAt = Date.now();
  phaseEndsAt = Date.now() + planningMs;
  worldStatus = "running";
  completionReason = undefined;
  scheduleBeatTimer(planningMs);
}

function enterLobby(): void {
  resetBeatLoop();
  worldStatus = "lobby";
  completionReason = undefined;
}

function completeWorld(reason: string): void {
  stopBeatLoop();
  resetBeatLoop();
  worldStatus = "completed";
  completionReason = reason;
}

function isWorldResolved(): boolean {
  const heroes = store.getState().heroes;
  return heroes.length > 0 && heroes.every((hero) => hero.status !== "alive");
}

function maybeCompleteResolvedWorld(): boolean {
  if (worldStatus !== "running" || !isWorldResolved()) {
    return false;
  }

  completeWorld(
    "All attached heroes have finished this world. Create a new world to play again.",
  );
  return true;
}

function isWorldRunning(): boolean {
  return worldStatus === "running";
}

function isWorldCompleted(): boolean {
  return worldStatus === "completed";
}

function isWorldInLobby(): boolean {
  return worldStatus === "lobby";
}

function stopWorldLoop(): void {
  completeWorld("Duel ended by operator. This world is complete.");
}

function getAttachedHeroCount(): number {
  return store.getState().heroes.length;
}

function canStartWorld(): boolean {
  const attachedHeroes = getAttachedHeroCount();
  const requiredHeroes = expectedHeroes > 0 ? expectedHeroes : null;

  if (!isWorldInLobby()) {
    return false;
  }

  return requiredHeroes !== null
    ? attachedHeroes === requiredHeroes
    : attachedHeroes > 0;
}

function canCreateNewWorld(): boolean {
  return !isWorldRunning();
}

function getLobbyInfo() {
  const attachedHeroes = getAttachedHeroCount();
  const requiredHeroes = expectedHeroes > 0 ? expectedHeroes : null;

  return {
    attachedHeroes,
    requiredHeroes,
    canStart: canStartWorld(),
    canReset: canCreateNewWorld(),
    status: worldStatus,
    started: isWorldRunning(),
    completionReason,
  };
}

function getTurnState(): TurnState {
  const now = Date.now();
  return {
    turn: store.getState().turn,
    phase: turnPhase,
    started: isWorldRunning(),
    phaseEndsAt,
    phaseDurationMs: phaseEndsAt - phaseStartedAt,
    phaseElapsedMs: now - phaseStartedAt,
    seed: store.getState().seed,
  };
}

function createSnapshot(): DashboardSnapshot {
  return {
    ...store.getSnapshot(),
    turnState: getTurnState(),
    lobby: getLobbyInfo(),
  };
}

function broadcast(msg: StreamEnvelope): void {
  const encoded = `event: ${msg.type}\ndata: ${typeof msg.payload === "string" ? msg.payload : JSON.stringify(msg.payload)}\n\n`;
  for (const client of streamClients) {
    client.reply.raw.write(encoded);
  }
}

async function transitionPhase(): Promise<void> {
  if (!isWorldRunning()) {
    return;
  }

  if (turnPhase === "submit") {
    turnPhase = "resolve";
    phaseStartedAt = Date.now();
    phaseEndsAt = Date.now() + actionMs;

    broadcast({ type: "snapshot", payload: createSnapshot() });
    broadcast({
      type: "log",
      payload: `Turn ${store.getState().turn} — RESOLVE window (${actionMs / 1000}s)`,
    });
    scheduleBeatTimer(actionMs);
    return;
  }

  store.stepWorld();
  await store.persist();

  if (maybeCompleteResolvedWorld()) {
    const snapshot = createSnapshot();
    broadcast({ type: "snapshot", payload: snapshot });
    broadcast({
      type: "log",
      payload: snapshot.lobby.completionReason ?? "World completed.",
    });
    return;
  }

  turnPhase = "submit";
  phaseStartedAt = Date.now();
  phaseEndsAt = Date.now() + planningMs;

  const snapshot = createSnapshot();
  broadcast({ type: "snapshot", payload: snapshot });
  broadcast({
    type: "log",
    payload: `Turn ${snapshot.world.turn} — SUBMIT window (${planningMs / 1000}s)`,
  });
  scheduleBeatTimer(planningMs);
}

function scheduleBeatTimer(ms: number): void {
  if (phaseTimer) clearTimeout(phaseTimer);
  phaseTimer = setTimeout(() => {
    transitionPhase().catch((err) => app.log.error(err));
  }, ms);
}

async function boot(): Promise<void> {
  await store.init();
  if (resetOnBoot) {
    await store.reset(seed);
  }

  /* ── Dashboard ── */
  app.get("/", async (_req, reply) => {
    reply.type("text/html").send(dashboardHtml);
  });

  /* ── API ── */
  app.get("/api/health", async () => ({
    ok: true,
    turn: store.getState().turn,
    heroes: getAttachedHeroCount(),
    maxHeroes: maxHeroes > 0 ? maxHeroes : null,
    expectedHeroes: expectedHeroes > 0 ? expectedHeroes : null,
    canStart: getLobbyInfo().canStart,
    turnState: getTurnState(),
  }));

  app.get("/api/dashboard", async () => createSnapshot());

  app.get("/api/seed", async () => ({ seed: store.getState().seed }));

  app.get("/api/leaderboard", async () => ({
    leaderboard: store.getSnapshot().leaderboard,
  }));

  app.post("/api/admin/reset", async (_req, reply) => {
    if (!canCreateNewWorld()) {
      reply.code(409);
      return {
        ok: false,
        error: "world_running",
        message: "Cannot create a new world while the current duel is running.",
        turnState: getTurnState(),
        snapshot: createSnapshot(),
      };
    }

    const nextSeed = createSeed();
    await store.reset(nextSeed, { preserveHeroes: true });
    enterLobby();
    const snapshot = createSnapshot();
    broadcast({ type: "snapshot", payload: snapshot });
    broadcast({
      type: "log",
      payload: `New world created — seed=${nextSeed} | attached bots=${snapshot.lobby.attachedHeroes}`,
    });
    return { ok: true, seed: nextSeed, turnState: getTurnState(), snapshot };
  });

  app.post("/api/admin/start", async () => {
    if (isWorldRunning()) {
      const snapshot = createSnapshot();
      return {
        ok: true,
        alreadyStarted: true,
        seed: store.getState().seed,
        turnState: getTurnState(),
        snapshot,
      };
    }

    if (isWorldCompleted()) {
      const snapshot = createSnapshot();
      return {
        ok: false,
        error: "world_completed",
        message:
          "This world is complete. Create a new world before starting again.",
        turnState: getTurnState(),
        snapshot,
      };
    }

    if (!canStartWorld()) {
      const snapshot = createSnapshot();
      return {
        ok: false,
        error: "waiting_for_heroes",
        message:
          expectedHeroes > 0
            ? `Need exactly ${expectedHeroes} attached heroes before starting. Current: ${getAttachedHeroCount()}`
            : "Attach at least one bot before starting the duel.",
        turnState: getTurnState(),
        snapshot,
      };
    }

    startWorldLoop();
    const snapshot = createSnapshot();
    broadcast({ type: "snapshot", payload: snapshot });
    broadcast({
      type: "log",
      payload: `World started — seed=${store.getState().seed}`,
    });
    return {
      ok: true,
      seed: store.getState().seed,
      turnState: getTurnState(),
      snapshot,
    };
  });

  app.post("/api/admin/stop", async () => {
    if (!isWorldRunning()) {
      const snapshot = createSnapshot();
      return {
        ok: true,
        alreadyStopped: true,
        seed: store.getState().seed,
        turnState: getTurnState(),
        snapshot,
      };
    }

    stopWorldLoop();
    const snapshot = createSnapshot();
    broadcast({ type: "snapshot", payload: snapshot });
    broadcast({
      type: "log",
      payload:
        snapshot.lobby.completionReason ??
        `World completed — turn=${store.getState().turn}`,
    });
    return {
      ok: true,
      seed: store.getState().seed,
      turnState: getTurnState(),
      snapshot,
    };
  });

  app.get("/api/stream", async (_req, reply) => {
    reply.raw.setHeader("Content-Type", "text/event-stream");
    reply.raw.setHeader("Cache-Control", "no-cache, no-transform");
    reply.raw.setHeader("Connection", "keep-alive");
    reply.raw.write(
      `event: snapshot\ndata: ${JSON.stringify(createSnapshot())}\n\n`,
    );
    const client = { reply };
    streamClients.add(client);
    _req.raw.on("close", () => streamClients.delete(client));
  });

  app.post<{ Body: HeroRegistration }>(
    "/api/heroes/register",
    async (req, reply) => {
      let hero: ReturnType<typeof store.registerHero>;
      try {
        hero = store.registerHero(req.body);
      } catch (err) {
        if (err instanceof HeroCapacityError) {
          reply.code(409);
          return {
            error: "hero_capacity_reached",
            message: `World is full. Max heroes: ${err.maxHeroes}`,
            turnState: getTurnState(),
          };
        }
        throw err;
      }
      store.addSystemEvent(`${hero.name} entered the dungeon.`);
      await store.persist();
      broadcast({ type: "snapshot", payload: createSnapshot() });
      broadcast({
        type: "log",
        payload: `${hero.name} joined — "${hero.strategy}" [${hero.trait}]`,
      });
      return { ...hero, turnState: getTurnState() };
    },
  );

  app.post<{ Params: { heroId: string }; Body: { message?: string } }>(
    "/api/heroes/:heroId/log",
    async (req, reply) => {
      const message = req.body?.message?.trim();
      if (!message) {
        reply.code(400);
        return { ok: false, message: "message required" };
      }
      store.addBotMessage(req.params.heroId, message);
      broadcast({ type: "snapshot", payload: createSnapshot() });
      return { ok: true };
    },
  );

  app.get<{ Params: { heroId: string } }>(
    "/api/heroes/:heroId/observe",
    async (req) => {
      const vision = store.getVision(req.params.heroId);
      return { ...vision, turnState: getTurnState() };
    },
  );

  app.post<{ Params: { heroId: string }; Body: HeroAction }>(
    "/api/heroes/:heroId/act",
    async (req, reply) => {
      if (turnPhase !== "submit") {
        reply.code(409);
        return {
          error: "wrong_phase",
          message: `Actions only accepted during submit phase. Current: ${turnPhase}`,
          turnState: getTurnState(),
        };
      }
      const result = store.submitAction(req.params.heroId, req.body);
      await store.persist();
      broadcast({
        type: "log",
        payload: `${req.params.heroId} → ${req.body.kind}${req.body.direction ? " " + req.body.direction : ""}`,
      });
      return { ...result, turnState: getTurnState() };
    },
  );

  /* ── Start ── */
  enterLobby();

  await app.listen({ port, host: "0.0.0.0" });
  app.log.info(
    `Neural Necropolis on http://localhost:${port} | seed=${store.getState().seed} | submit=${planningMs}ms resolve=${actionMs}ms | maxHeroes=${maxHeroes || "unlimited"} | expectedHeroes=${expectedHeroes || "none"} | resetOnBoot=${resetOnBoot}`,
  );
}

boot().catch((err) => {
  console.error(err);
  process.exit(1);
});
