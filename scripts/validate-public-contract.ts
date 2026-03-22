import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import type {
  ActionConflictResponse,
  ActionResponse,
  BoardSnapshot,
  BoardSummary,
  BoardLifecycle,
  CompletedBoard,
  CompletedBoardsResponse,
  DashboardResponse,
  GameSettings,
  HeartbeatResponse,
  HealthResponse,
  HeroLogRequest,
  HeroStatus,
  LobbyInfo,
  LogErrorResponse,
  LogResponse,
  ManagerSnapshot,
  ObserveResponse,
  RegisterResponse,
  SeedResponse,
  TurnState,
  VisionData,
} from "@neural-necropolis/protocol-ts";

type OpenApiDocument = {
  components?: {
    schemas?: Record<string, OpenApiSchema>;
  };
};

type OpenApiSchema = {
  required?: string[];
  enum?: string[];
  allOf?: OpenApiSchema[];
  $ref?: string;
};

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) {
    throw new Error(message);
  }
}

function loadDocument(): OpenApiDocument {
  const filePath = resolve("docs", "PUBLIC_API.openapi.json");
  return JSON.parse(readFileSync(filePath, "utf8")) as OpenApiDocument;
}

function getSchema(doc: OpenApiDocument, name: string): OpenApiSchema {
  const schema = doc.components?.schemas?.[name];
  assert(schema, `Missing OpenAPI schema: ${name}`);
  return schema;
}

function collectRequiredKeys(
  doc: OpenApiDocument,
  schema: OpenApiSchema,
): Set<string> {
  const required = new Set(schema.required ?? []);
  for (const entry of schema.allOf ?? []) {
    if (entry.$ref) {
      const refName = entry.$ref.replace("#/components/schemas/", "");
      for (const key of collectRequiredKeys(doc, getSchema(doc, refName))) {
        required.add(key);
      }
      continue;
    }
    for (const key of collectRequiredKeys(doc, entry)) {
      required.add(key);
    }
  }
  return required;
}

function expectRequired(
  doc: OpenApiDocument,
  name: string,
  requiredKeys: string[],
): void {
  const schema = getSchema(doc, name);
  const required = collectRequiredKeys(doc, schema);
  for (const key of requiredKeys) {
    assert(required.has(key), `${name} is missing required property ${key}`);
  }
}

function expectEnum(
  doc: OpenApiDocument,
  name: string,
  expectedValues: string[],
): void {
  const schema = getSchema(doc, name);
  const values = schema.enum ?? [];
  assert(
    expectedValues.length === values.length &&
      expectedValues.every((value, index) => values[index] === value),
    `${name} enum drifted. Expected ${expectedValues.join(", ")}, got ${values.join(", ")}`,
  );
}

function expectAllOfRef(
  doc: OpenApiDocument,
  name: string,
  refName: string,
): void {
  const schema = getSchema(doc, name);
  const refs = (schema.allOf ?? []).map((entry) => entry.$ref);
  assert(
    refs.includes(`#/components/schemas/${refName}`),
    `${name} no longer composes ${refName}`,
  );
}

const turnStateFixture = {
  turn: 4,
  phase: "submit",
  started: true,
  submitWindowMs: 3000,
  resolveWindowMs: 500,
  phaseEndsAt: 1_700_000_000_000,
  phaseDurationMs: 3000,
  phaseElapsedMs: 1200,
  seed: "seed-123",
  warmupRemainingMs: 0,
} satisfies TurnState;

const gameSettingsFixture = {
  paused: false,
} satisfies GameSettings;

const visionFixture = {
  seed: "seed-123",
  turn: 4,
  boardId: "board-1",
  boardStatus: "running",
  hero: {
    id: "hero-1",
    name: "Scout",
    strategy: "explore",
    trait: "curious",
    stats: {
      maxHp: 40,
      hp: 32,
      attack: 5,
      defense: 3,
      speed: 4,
      perception: 7,
    },
    baseStats: {
      maxHp: 40,
      hp: 40,
      attack: 5,
      defense: 3,
      speed: 3,
      perception: 5,
    },
    position: { x: 2, y: 3 },
    score: 12,
    kills: 1,
    tilesExplored: 8,
    gold: 15,
    inventory: [],
    equipment: { weapon: null, armor: null, accessory: null },
    effects: [],
    fatigue: 10,
    morale: 55,
    status: "alive",
    lastAction: "move north",
    turnsSurvived: 4,
  },
  visibleTiles: [{ x: 2, y: 3, kind: "floor" }],
  visibleMonsters: [],
  visibleHeroes: [],
  visibleNpcs: [],
  visibleItems: [],
  recentEvents: [],
  legalActions: [{ kind: "wait", description: "Wait in place" }],
  turnState: turnStateFixture,
  gameSettings: gameSettingsFixture,
} satisfies VisionData;

const lobbyFixture = {
  boardId: "board-1",
  boardSlug: "bone-cairn",
  boardName: "Bone Cairn",
  attachedHeroes: 1,
  maxHeroes: 6,
  requiredHeroes: 2,
  minHeroesToStart: 2,
  canStart: false,
  canReset: true,
  queueStatus: "waiting",
  warmupRemainingMs: 5000,
  status: "open",
  started: false,
  completionReason: "heroes escaped",
} satisfies LobbyInfo;

const boardSummaryFixture = {
  boardId: "board-1",
  boardSlug: "bone-cairn",
  boardName: "Bone Cairn",
  status: "running",
  queueStatus: "active",
  warmupRemainingMs: 0,
  heroCount: 1,
  maxHeroes: 6,
  turn: 4,
  seed: "seed-123",
  completionReason: "heroes escaped",
} satisfies BoardSummary;

const boardSnapshotFixture = {
  seed: "seed-123",
  boardId: "board-1",
  boardSlug: "bone-cairn",
  world: {
    dungeonName: "Bone Cairn",
    turn: 4,
    mapWidth: 48,
    mapHeight: 32,
  },
  heroes: [visionFixture.hero],
  leaderboard: [
    {
      heroId: "hero-1",
      heroName: "Scout",
      trait: "curious",
      totalScore: 12,
      combatScore: 4,
      treasureScore: 3,
      explorationScore: 5,
      questScore: 0,
      turnsSurvived: 4,
      tilesExplored: 8,
      monstersKilled: 1,
      escaped: false,
      status: "alive",
    },
  ],
  monsters: [],
  npcs: [],
  floorItems: [],
  map: [["floor"]],
  recentEvents: [],
  botMessages: [],
  turnState: turnStateFixture,
  lobby: lobbyFixture,
} satisfies BoardSnapshot;

const dashboardFixture = {
  ...boardSnapshotFixture,
  gameSettings: gameSettingsFixture,
} satisfies DashboardResponse;

const managerFixture = {
  boards: [boardSummaryFixture],
} satisfies ManagerSnapshot;

const registerFixture = {
  id: "hero-1",
  name: "Scout",
  trait: "curious",
  strategy: "explore",
  stats: visionFixture.hero.stats,
  position: visionFixture.hero.position,
  boardId: "board-1",
  turnState: turnStateFixture,
} satisfies RegisterResponse;

const healthFixture = {
  ok: true,
  turnState: turnStateFixture,
} satisfies HealthResponse;

const observeFixture = visionFixture satisfies ObserveResponse;

const heartbeatFixture = {
  ok: true,
  boardId: "board-1",
  requestId: "request-1",
  turnState: turnStateFixture,
  leaseExpiresAt: 1_700_000_030_000,
  leaseTtlMs: 30_000,
  sessionStatus: "active",
} satisfies HeartbeatResponse;

const actionFixture = {
  accepted: true,
  message: "queued",
  turnState: turnStateFixture,
} satisfies ActionResponse;

const actionConflictFixture = {
  error: "wrong_phase",
  message: "submit window closed",
  turnState: turnStateFixture,
} satisfies ActionConflictResponse;

const logRequestFixture = {
  message: "hero waiting",
} satisfies HeroLogRequest;

const logFixture = {
  ok: true,
} satisfies LogResponse;

const logErrorFixture = {
  ok: false,
} satisfies LogErrorResponse;

const completedBoardFixture = {
  boardId: "board-1",
  boardSlug: "bone-cairn",
  boardName: "Bone Cairn",
  turn: 8,
  completionReason: "heroes escaped",
  seed: "seed-123",
  heroCount: 2,
  monsterCount: 5,
  topLeaderboard: boardSnapshotFixture.leaderboard,
} satisfies CompletedBoard;

const completedBoardsFixture = {
  boards: [completedBoardFixture],
  total: 1,
  offset: 0,
  limit: 10,
} satisfies CompletedBoardsResponse;

const seedFixture = {
  seed: "seed-123",
} satisfies SeedResponse;

const lifecycleValues: BoardLifecycle[] = [
  "queued",
  "open",
  "running",
  "completed",
];
const heroStatusValues: HeroStatus[] = ["alive", "dead", "escaped"];

void [
  turnStateFixture,
  gameSettingsFixture,
  visionFixture,
  lobbyFixture,
  boardSummaryFixture,
  boardSnapshotFixture,
  dashboardFixture,
  managerFixture,
  registerFixture,
  healthFixture,
  observeFixture,
  heartbeatFixture,
  actionFixture,
  actionConflictFixture,
  logRequestFixture,
  logFixture,
  logErrorFixture,
  completedBoardFixture,
  completedBoardsFixture,
  seedFixture,
  lifecycleValues,
  heroStatusValues,
];

function main(): void {
  const doc = loadDocument();

  expectEnum(doc, "BoardLifecycle", ["queued", "open", "running", "completed"]);
  expectEnum(doc, "HeroStatus", ["alive", "dead", "escaped"]);
  expectRequired(doc, "TurnState", [
    "turn",
    "phase",
    "started",
    "submitWindowMs",
    "resolveWindowMs",
    "phaseEndsAt",
    "phaseDurationMs",
    "phaseElapsedMs",
    "seed",
  ]);
  expectRequired(doc, "ObserveResponse", [
    "seed",
    "turn",
    "boardId",
    "boardStatus",
    "hero",
    "visibleTiles",
    "visibleMonsters",
    "visibleHeroes",
    "visibleNpcs",
    "visibleItems",
    "recentEvents",
    "legalActions",
    "turnState",
    "gameSettings",
    "leaseExpiresAt",
    "leaseTtlMs",
    "sessionStatus",
  ]);
  expectRequired(doc, "LobbyInfo", [
    "boardId",
    "boardSlug",
    "boardName",
    "attachedHeroes",
    "maxHeroes",
    "requiredHeroes",
    "minHeroesToStart",
    "canStart",
    "canReset",
    "status",
    "started",
  ]);
  expectRequired(doc, "BoardSummary", [
    "boardId",
    "boardSlug",
    "boardName",
    "status",
    "heroCount",
    "maxHeroes",
    "turn",
    "seed",
  ]);
  expectRequired(doc, "BoardSnapshot", [
    "seed",
    "boardId",
    "boardSlug",
    "world",
    "heroes",
    "leaderboard",
    "monsters",
    "npcs",
    "floorItems",
    "map",
    "recentEvents",
    "botMessages",
    "turnState",
    "lobby",
  ]);
  expectRequired(doc, "HealthResponse", ["ok", "turnState"]);
  expectRequired(doc, "RegisterResponse", [
    "id",
    "name",
    "trait",
    "strategy",
    "stats",
    "position",
    "boardId",
    "sessionToken",
    "requestId",
    "turnState",
    "leaseExpiresAt",
    "leaseTtlMs",
    "sessionStatus",
  ]);
  expectRequired(doc, "HeartbeatResponse", [
    "ok",
    "boardId",
    "requestId",
    "turnState",
    "leaseExpiresAt",
    "leaseTtlMs",
    "sessionStatus",
  ]);
  expectRequired(doc, "ActionResponse", ["accepted", "message", "turnState"]);
  expectRequired(doc, "ActionConflictResponse", [
    "error",
    "message",
    "turnState",
  ]);
  expectRequired(doc, "CompletedBoardsResponse", [
    "boards",
    "total",
    "offset",
    "limit",
  ]);
  expectAllOfRef(doc, "DashboardResponse", "BoardSnapshot");

  process.stdout.write("Public API contract validation passed.\n");
}

main();
