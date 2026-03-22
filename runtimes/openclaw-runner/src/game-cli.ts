import { config as loadEnv } from "dotenv";
import { randomUUID } from "node:crypto";
import {
  existsSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  HeroApi,
  resolveBaseUrl,
  resolveConnectionOptions,
} from "@neural-necropolis/agent-sdk";
import type {
  ActionKind,
  BoardLifecycle,
  BoardSummary,
  DashboardResponse,
  Direction,
  HeroAction,
  HeroRegistration,
  HeroTrait,
  ManagerSnapshot,
  RegisterResponse,
  TurnState,
  VisionData,
} from "@neural-necropolis/protocol-ts";

const moduleDir = dirname(fileURLToPath(import.meta.url));
loadEnv({ path: resolve(moduleDir, "../../../.env") });
loadEnv({ path: resolve(moduleDir, "../.env"), override: true });

type CommandName = "register" | "step" | "bootstrap" | "act" | "reset";

type ParsedArgs = {
  command: CommandName | "help";
  options: Record<string, string | boolean>;
};

type HeroPersona = "scout" | "raider" | "slayer" | "warden";

type SessionState = {
  session: string;
  baseUrl: string;
  hero: HeroRegistration;
  heroSlug?: string;
  heroPersona?: HeroPersona;
  createdAt: number;
  updatedAt: number;
  lastBoardId?: string;
};

const DEFAULT_SESSION = "default";
const DEFAULT_NAME = "OpenClaw Raider";
const DEFAULT_STRATEGY = "choose only legal actions, survive, loot, and escape";
const DEFAULT_TRAIT: HeroTrait = "curious";
const DEFAULT_PERSONA: HeroPersona = "raider";
const VALID_TRAITS: readonly HeroTrait[] = [
  "aggressive",
  "cautious",
  "greedy",
  "curious",
  "resilient",
];
const VALID_ACTION_KINDS: readonly ActionKind[] = [
  "move",
  "attack",
  "rest",
  "use_item",
  "interact",
  "wait",
];
const VALID_DIRECTIONS: readonly Direction[] = [
  "north",
  "south",
  "east",
  "west",
];
const VALID_PERSONAS: readonly HeroPersona[] = [
  "scout",
  "raider",
  "slayer",
  "warden",
];
const PERSONA_PRESETS: Record<
  HeroPersona,
  { trait: HeroTrait; strategy: string; summary: string }
> = {
  scout: {
    trait: "curious",
    strategy:
      "explore aggressively, reveal new tiles, avoid unnecessary fights, and escape if cornered",
    summary: "prefers exploration and avoiding dead ends",
  },
  raider: {
    trait: "greedy",
    strategy:
      "loot treasure and chests, stay alive, and extract with valuables",
    summary: "prefers loot and high-value movement",
  },
  slayer: {
    trait: "aggressive",
    strategy:
      "hunt nearby monsters, keep initiative, and use potions only when needed",
    summary: "prefers combat pressure and chasing monsters",
  },
  warden: {
    trait: "resilient",
    strategy:
      "survive first, avoid traps, rest early, and only fight on favorable terms",
    summary: "prefers survival, healing, and low-risk play",
  },
};

function parseArgs(argv: string[]): ParsedArgs {
  const [rawCommand, ...rest] = argv;
  const command =
    rawCommand === "register" ||
    rawCommand === "step" ||
    rawCommand === "bootstrap" ||
    rawCommand === "act" ||
    rawCommand === "reset"
      ? rawCommand
      : "help";
  const options: Record<string, string | boolean> = {};

  for (let index = 0; index < rest.length; index += 1) {
    const token = rest[index];
    if (!token.startsWith("--")) continue;
    const key = token.slice(2);
    const next = rest[index + 1];
    if (!next || next.startsWith("--")) {
      options[key] = true;
      continue;
    }
    options[key] = next;
    index += 1;
  }

  return { command, options };
}

function getStringOption(
  options: Record<string, string | boolean>,
  key: string,
): string | undefined {
  const value = options[key];
  return typeof value === "string" ? value.trim() : undefined;
}

function requireStringOption(
  options: Record<string, string | boolean>,
  key: string,
): string {
  const value = getStringOption(options, key);
  if (!value) {
    throw new Error(`Missing required --${key} option.`);
  }
  return value;
}

function sanitizeSession(session: string): string {
  return session.toLowerCase().replace(/[^a-z0-9_-]+/g, "-");
}

function titleCaseSlug(slug: string): string {
  return slug
    .split(/[-_]+/)
    .filter((part) => part.length > 0)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

function formatOpenClawLabel(slug: string): string {
  return titleCaseSlug(slug).replace(/\bOpenclaw\b/g, "OpenClaw");
}

function buildDefaultHeroName(slug: string): string {
  const label = formatOpenClawLabel(slug);
  if (/^openclaw(?:$|[-_])/i.test(slug)) {
    return label;
  }
  return `OpenClaw ${label}`;
}

function resolveHeroSlug(
  session: string,
  options: Record<string, string | boolean>,
  existing: SessionState | null,
): string | undefined {
  const explicitSlug = getStringOption(options, "slug");
  if (explicitSlug) return sanitizeSession(explicitSlug);
  if (existing?.heroSlug) return existing.heroSlug;
  return session === DEFAULT_SESSION ? undefined : sanitizeSession(session);
}

function stateFilePath(session: string): string {
  return resolve("tmp", `openclaw-session-${sanitizeSession(session)}.json`);
}

function loadState(session: string): SessionState | null {
  const filePath = stateFilePath(session);
  if (!existsSync(filePath)) return null;
  return JSON.parse(readFileSync(filePath, "utf8")) as SessionState;
}

function saveState(state: SessionState): string {
  const filePath = stateFilePath(state.session);
  mkdirSync(resolve("tmp"), { recursive: true });
  writeFileSync(filePath, `${JSON.stringify(state, null, 2)}\n`, "utf8");
  return filePath;
}

function deleteState(session: string): string {
  const filePath = stateFilePath(session);
  if (existsSync(filePath)) {
    rmSync(filePath);
  }
  return filePath;
}

function resolveTrait(value?: string, fallback = DEFAULT_TRAIT): HeroTrait {
  if (!value) return fallback;
  const trait = value.trim().toLowerCase() as HeroTrait;
  if (VALID_TRAITS.includes(trait)) return trait;
  throw new Error(
    `Invalid trait "${value}". Expected one of: ${VALID_TRAITS.join(", ")}.`,
  );
}

function resolvePersona(
  value: string | undefined,
  fallback = DEFAULT_PERSONA,
): HeroPersona {
  if (!value) return fallback;
  const persona = value.trim().toLowerCase() as HeroPersona;
  if (VALID_PERSONAS.includes(persona)) return persona;
  throw new Error(
    `Invalid persona "${value}". Expected one of: ${VALID_PERSONAS.join(", ")}.`,
  );
}

function buildState(
  session: string,
  options: Record<string, string | boolean>,
  existing: SessionState | null,
): SessionState {
  const now = Date.now();
  const heroSlug = resolveHeroSlug(session, options, existing);
  const heroPersona = resolvePersona(
    getStringOption(options, "persona") ?? existing?.heroPersona,
    existing?.heroPersona ?? DEFAULT_PERSONA,
  );
  const personaPreset = PERSONA_PRESETS[heroPersona];
  const explicitHeroId = getStringOption(options, "hero-id");
  const heroId = explicitHeroId
    ? sanitizeSession(explicitHeroId)
    : heroSlug
      ? `openclaw-${heroSlug}`
      : (existing?.hero.id ??
        `openclaw-${sanitizeSession(session)}-${randomUUID()}`);
  const hero: HeroRegistration = {
    id: heroId,
    name:
      getStringOption(options, "name") ??
      (heroSlug ? buildDefaultHeroName(heroSlug) : undefined) ??
      existing?.hero.name ??
      DEFAULT_NAME,
    strategy:
      getStringOption(options, "strategy") ??
      existing?.hero.strategy ??
      personaPreset.strategy ??
      DEFAULT_STRATEGY,
    preferredTrait: resolveTrait(
      getStringOption(options, "trait") ?? existing?.hero.preferredTrait,
      existing?.hero.preferredTrait ?? personaPreset.trait ?? DEFAULT_TRAIT,
    ),
  };

  return {
    session,
    baseUrl: resolveBaseUrl(
      getStringOption(options, "base-url") ?? existing?.baseUrl,
    ),
    hero,
    heroSlug,
    heroPersona,
    createdAt: existing?.createdAt ?? now,
    updatedAt: now,
    lastBoardId: existing?.lastBoardId,
  };
}

function createApi(state: SessionState): HeroApi {
  return new HeroApi({ baseUrl: state.baseUrl }, state.hero);
}

async function fetchJson<T>(baseUrl: string, pathname: string): Promise<T> {
  const connection = resolveConnectionOptions({ baseUrl });
  const headers = { ...connection.headers };
  if (connection.authToken) {
    headers.Authorization = `Bearer ${connection.authToken}`;
  }
  const response = await fetch(`${connection.baseUrl}${pathname}`, {
    headers,
  });
  if (!response.ok) {
    throw new Error(`${pathname} failed: ${response.status}`);
  }
  return response.json() as Promise<T>;
}

async function readDashboard(baseUrl: string): Promise<DashboardResponse> {
  return fetchJson<DashboardResponse>(baseUrl, "/api/dashboard");
}

async function readBoardQueue(baseUrl: string): Promise<ManagerSnapshot> {
  return fetchJson<ManagerSnapshot>(baseUrl, "/api/boards");
}

function summarizeBoard(board: BoardSummary) {
  return {
    boardId: board.boardId,
    boardName: board.boardName,
    boardSlug: board.boardSlug,
    status: board.status,
    queueStatus: board.queueStatus ?? null,
    heroCount: board.heroCount,
    maxHeroes: board.maxHeroes,
    turn: board.turn,
    joinWindowRemainingMs: board.joinWindowRemainingMs ?? 0,
    completionReason: board.completionReason ?? null,
  };
}

function boardHasRoom(board: BoardSummary): boolean {
  return board.maxHeroes <= 0 || board.heroCount < board.maxHeroes;
}

function mapLobbyStatusToBoardStatus(status: BoardLifecycle): BoardLifecycle {
  return status;
}

async function collectBootstrapScan(baseUrl: string): Promise<{
  turnState: TurnState;
  activeBoard: ReturnType<typeof summarizeBoard> & {
    attachedHeroes: number;
    requiredHeroes: number | null;
    canStart: boolean;
    started: boolean;
    paused: boolean;
  };
  joinableBoards: Array<ReturnType<typeof summarizeBoard>>;
  nextJoinableBoard: ReturnType<typeof summarizeBoard> | null;
}> {
  const [health, dashboard, queue] = await Promise.all([
    fetchJson<{ turnState: TurnState }>(baseUrl, "/api/health"),
    readDashboard(baseUrl),
    readBoardQueue(baseUrl),
  ]);
  const joinableBoards = queue.boards
    .filter((board) => board.status === "open" && boardHasRoom(board))
    .map((board) => summarizeBoard(board));
  const nextJoinableBoard = joinableBoards[0] ?? null;

  return {
    turnState: health.turnState,
    activeBoard: {
      boardId: dashboard.boardId,
      boardName: dashboard.world.dungeonName,
      boardSlug: dashboard.boardSlug,
      status: mapLobbyStatusToBoardStatus(dashboard.lobby.status),
      queueStatus: dashboard.lobby.queueStatus ?? null,
      heroCount: dashboard.heroes.length,
      maxHeroes: dashboard.lobby.maxHeroes,
      turn: dashboard.world.turn,
      joinWindowRemainingMs: dashboard.lobby.joinWindowRemainingMs ?? 0,
      completionReason: dashboard.lobby.completionReason ?? null,
      attachedHeroes: dashboard.lobby.attachedHeroes,
      requiredHeroes: dashboard.lobby.requiredHeroes,
      canStart: dashboard.lobby.canStart,
      started: dashboard.lobby.started,
      paused: dashboard.gameSettings.paused,
    },
    joinableBoards,
    nextJoinableBoard,
  };
}

function summarizeVision(vision: VisionData, turnState: TurnState) {
  return {
    seed: vision.seed,
    boardId: vision.boardId ?? null,
    boardStatus: vision.boardStatus ?? null,
    actionNeeded:
      turnState.started &&
      turnState.phase === "submit" &&
      vision.hero.status === "alive" &&
      vision.boardStatus !== "completed",
    turnState,
    hero: {
      id: vision.hero.id,
      name: vision.hero.name,
      trait: vision.hero.trait,
      status: vision.hero.status,
      score: vision.hero.score,
      gold: vision.hero.gold,
      fatigue: vision.hero.fatigue,
      morale: vision.hero.morale,
      hp: vision.hero.stats.hp,
      maxHp: vision.hero.stats.maxHp,
      attack: vision.hero.stats.attack,
      defense: vision.hero.stats.defense,
      speed: vision.hero.stats.speed,
      perception: vision.hero.stats.perception,
      position: vision.hero.position,
      effects: vision.hero.effects,
      inventory: vision.hero.inventory.map((item) => ({
        id: item.id,
        kind: item.kind,
        name: item.name,
      })),
    },
    visibleMonsters: vision.visibleMonsters.map((monster) => ({
      id: monster.id,
      kind: monster.kind,
      name: monster.name,
      hp: monster.hp,
      maxHp: monster.maxHp,
      position: monster.position,
      behavior: monster.behavior,
      effects: monster.effects,
    })),
    visibleHeroes: vision.visibleHeroes.map((hero) => ({
      id: hero.id,
      name: hero.name,
      status: hero.status,
      hp: hero.stats.hp,
      maxHp: hero.stats.maxHp,
      position: hero.position,
    })),
    visibleItems: vision.visibleItems.map((floorItem) => ({
      id: floorItem.id,
      name: floorItem.item.name,
      kind: floorItem.item.kind,
      position: floorItem.position,
      value: floorItem.item.value,
    })),
    visibleNpcs: vision.visibleNpcs.map((npc) => ({
      id: npc.id,
      kind: npc.kind,
      name: npc.name,
      position: npc.position,
    })),
    visibleTiles: vision.visibleTiles,
    recentEvents: vision.recentEvents,
    landmarks: vision.landmarks ?? [],
    legalActions: vision.legalActions,
  };
}

function printJson(payload: unknown): void {
  process.stdout.write(`${JSON.stringify(payload, null, 2)}\n`);
}

function persistVisionState(state: SessionState, vision: VisionData): void {
  state.updatedAt = Date.now();
  state.lastBoardId = vision.boardId ?? state.lastBoardId;
  saveState(state);
}

async function commandRegister(options: Record<string, string | boolean>) {
  const session = sanitizeSession(
    getStringOption(options, "session") ?? DEFAULT_SESSION,
  );
  const state = buildState(session, options, loadState(session));
  const api = createApi(state);
  const result = await api.register();
  state.updatedAt = Date.now();
  state.lastBoardId = result.boardId;
  const filePath = saveState(state);

  printJson({
    ok: true,
    command: "register",
    session,
    stateFile: filePath,
    baseUrl: state.baseUrl,
    hero: state.hero,
    boardId: result.boardId,
    turnState: result.turnState ?? null,
  });
}

async function ensureVision(state: SessionState): Promise<{
  state: SessionState;
  vision: VisionData;
  turnState: TurnState;
  registered: boolean;
}> {
  const api = createApi(state);

  const registerAndObserve = async (): Promise<{
    state: SessionState;
    vision: VisionData;
    turnState: TurnState;
    registered: boolean;
  }> => {
    const registration: RegisterResponse = await api.register();
    const vision = await api.observe();
    const turnState =
      vision.turnState ?? registration.turnState ?? (await api.getTurnState());
    persistVisionState(state, vision);
    return { state, vision, turnState, registered: true };
  };

  try {
    const vision = await api.observe();
    const turnState =
      vision.turnState ?? api.turnState ?? (await api.getTurnState());

    if (vision.boardStatus === "completed" || vision.hero.status !== "alive") {
      return registerAndObserve();
    }

    persistVisionState(state, vision);
    return { state, vision, turnState, registered: false };
  } catch {
    return registerAndObserve();
  }
}

async function commandStep(options: Record<string, string | boolean>) {
  const session = sanitizeSession(
    getStringOption(options, "session") ?? DEFAULT_SESSION,
  );
  const state = buildState(session, options, loadState(session));
  const filePath = saveState(state);
  const { vision, turnState, registered } = await ensureVision(state);

  printJson({
    ok: true,
    command: "step",
    session,
    stateFile: filePath,
    baseUrl: state.baseUrl,
    registered,
    ...summarizeVision(vision, turnState),
  });
}

async function commandBootstrap(options: Record<string, string | boolean>) {
  const session = sanitizeSession(
    getStringOption(options, "session") ?? DEFAULT_SESSION,
  );
  const existing = loadState(session);
  const state = buildState(session, options, existing);
  const filePath = saveState(state);
  const scan = await collectBootstrapScan(state.baseUrl);
  const hadSavedHero = existing !== null;
  const { vision, turnState, registered } = await ensureVision(state);

  printJson({
    ok: true,
    command: "bootstrap",
    session,
    stateFile: filePath,
    baseUrl: state.baseUrl,
    server: {
      reachable: true,
      paused: scan.activeBoard.paused,
    },
    queue: {
      activeBoard: scan.activeBoard,
      joinableBoards: scan.joinableBoards,
      nextJoinableBoard: scan.nextJoinableBoard,
    },
    join: {
      hadSavedHero,
      registered,
      joinedBoardId: vision.boardId ?? null,
      heroId: state.hero.id,
      heroName: state.hero.name,
      trait: state.hero.preferredTrait,
      persona: state.heroPersona ?? DEFAULT_PERSONA,
    },
    ...summarizeVision(vision, turnState),
  });
}

function parseAction(options: Record<string, string | boolean>): HeroAction {
  const kind = requireStringOption(options, "kind").toLowerCase() as ActionKind;
  if (!VALID_ACTION_KINDS.includes(kind)) {
    throw new Error(
      `Invalid action kind "${kind}". Expected one of: ${VALID_ACTION_KINDS.join(", ")}.`,
    );
  }

  const directionValue = getStringOption(options, "direction")?.toLowerCase();
  const direction = directionValue as Direction | undefined;
  if (directionValue && !VALID_DIRECTIONS.includes(direction!)) {
    throw new Error(
      `Invalid direction "${directionValue}". Expected one of: ${VALID_DIRECTIONS.join(", ")}.`,
    );
  }

  return {
    kind,
    direction,
    targetId: getStringOption(options, "target-id"),
    itemId: getStringOption(options, "item-id"),
  };
}

async function commandAct(options: Record<string, string | boolean>) {
  const session = sanitizeSession(
    getStringOption(options, "session") ?? DEFAULT_SESSION,
  );
  const existing = loadState(session);
  if (!existing) {
    throw new Error(
      `No session file found for "${session}". Run register or step first.`,
    );
  }
  const state = buildState(session, options, existing);
  const api = createApi(state);
  const action = parseAction(options);
  const result = await api.act(action);
  state.updatedAt = Date.now();
  const filePath = saveState(state);

  printJson({
    ok: true,
    command: "act",
    session,
    stateFile: filePath,
    action,
    accepted: result.accepted,
    message: result.message,
    turnState: result.turnState ?? null,
  });
}

async function commandReset(options: Record<string, string | boolean>) {
  const session = sanitizeSession(
    getStringOption(options, "session") ?? DEFAULT_SESSION,
  );
  const filePath = deleteState(session);
  printJson({
    ok: true,
    command: "reset",
    session,
    stateFile: filePath,
  });
}

function printHelp(): void {
  printJson({
    ok: true,
    usage: [
      "npm run run:openclaw",
      'npm run run:openclaw:register -- --session claw --name "OpenClaw Raider" --trait curious',
      "npm run run:openclaw:register -- --session crypt-ash --slug crypt-ash",
      "npm run run:openclaw:register -- --session crypt-ash --slug crypt-ash --persona scout",
      "npm run run:openclaw:bootstrap -- --session claw",
      "npm run run:openclaw:step -- --session claw",
      "npm run run:openclaw:act -- --session claw --kind move --direction north",
      "npm run run:openclaw:reset -- --session claw",
    ],
    notes: [
      "Use npm run run:openclaw for fully agentic sessions.",
      "The CLI persists one hero session per --session value under tmp/.",
      "Use --base-url or NEURAL_NECROPOLIS_SERVER_URL when connecting to a remote server.",
      "Set NEURAL_NECROPOLIS_PLAYER_TOKEN when your deployment overrides the built-in player token.",
      "Use --slug to assign a stable dungeon-style identity and deterministic hero id for a session.",
      `Use --persona to choose a starting class/personality: ${VALID_PERSONAS.join(", ")}.`,
      "bootstrap checks paused/open/running state first, then joins the earliest open board with room.",
      "step will auto-register when no active hero exists for the saved session.",
      "act must match one of the latest legalActions returned by step.",
    ],
  });
}

async function main(): Promise<void> {
  const parsed = parseArgs(process.argv.slice(2));
  if (parsed.command === "help") {
    printHelp();
    return;
  }

  if (parsed.command === "register") {
    await commandRegister(parsed.options);
    return;
  }

  if (parsed.command === "step") {
    await commandStep(parsed.options);
    return;
  }

  if (parsed.command === "bootstrap") {
    await commandBootstrap(parsed.options);
    return;
  }

  if (parsed.command === "act") {
    await commandAct(parsed.options);
    return;
  }

  await commandReset(parsed.options);
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  printJson({ ok: false, error: message });
  process.exitCode = 1;
});
