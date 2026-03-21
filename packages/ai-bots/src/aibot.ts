import { config as loadEnv } from "dotenv";
import { randomUUID } from "node:crypto";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import OpenAI from "openai";
import { runHeroBot } from "@neural-necropolis/agent-sdk";
import type {
  EventRecord,
  FloorItem,
  GameSettings,
  HeroAction,
  HeroProfile,
  Landmark,
  LegalAction,
  Monster,
  Npc,
  VisionData,
  VisionTile,
} from "@neural-necropolis/protocol-ts";

const KNOWN_PROVIDER_URLS: Record<string, string> = {
  openai: "https://api.openai.com/v1",
  groq: "https://api.groq.com/openai/v1",
  together: "https://api.together.xyz/v1",
  fireworks: "https://api.fireworks.ai/inference/v1",
  perplexity: "https://api.perplexity.ai",
  ollama: "http://localhost:11434/v1",
};

const slotKeys = ["A", "B", "C", "D", "E", "F", "G", "H", "I", "J"] as const;
type SlotKey = (typeof slotKeys)[number];
type ReasoningEffort = OpenAI.Chat.ChatCompletionReasoningEffort;

type SlotConfig = {
  slotKey: SlotKey;
  providerName: string;
  modelAlias: string;
  modelId: string;
  label: string;
  baseUrl: string;
  apiKey: string;
  temperature: number;
  maxCompletionTokens: number;
  includeReasoning?: boolean;
  reasoningEffort?: ReasoningEffort;
  trait: "aggressive" | "cautious" | "greedy" | "curious" | "resilient";
  mission: string;
  includeExploredMemory: boolean;
};

type TurnMemory = { turn: number; action: string; reasoning: string };
type ExploredTileMemory = { kind: VisionTile["kind"]; turnSeen: number };

const moduleDir = dirname(fileURLToPath(import.meta.url));
loadEnv({ path: resolve(moduleDir, "../../../.env") });
loadEnv({ path: resolve(moduleDir, "../.env"), override: true });

const memory: TurnMemory[] = [];
const exploredTiles = new Map<string, ExploredTileMemory>();
const MAX_MEMORY = 20;
const MAX_EXPLORED_MEMORY_LINES = 10;

function readSlotEnv(slotKey: SlotKey, key: string, fallback = ""): string {
  const value = process.env[`AIBOT_${slotKey}_${key}`];
  return value && value.length > 0 ? value : fallback;
}

function readModelEnv(alias: string, key: string, fallback = ""): string {
  const value = process.env[`MODEL_${alias.toUpperCase()}_${key}`];
  return value && value.length > 0 ? value : fallback;
}

function parseIntegerEnv(value: string | undefined): number | undefined {
  if (!value) return undefined;
  const parsed = Number.parseInt(value.trim(), 10);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function parseFloatEnv(value: string | undefined): number | undefined {
  if (!value) return undefined;
  const parsed = Number.parseFloat(value.trim());
  return Number.isFinite(parsed) ? parsed : undefined;
}

function parseBooleanEnv(value: string | undefined): boolean | undefined {
  if (!value) return undefined;
  const normalized = value.trim().toLowerCase();
  if (["1", "true", "yes", "on"].includes(normalized)) return true;
  if (["0", "false", "no", "off"].includes(normalized)) return false;
  return undefined;
}

function parseReasoningEffortEnv(
  value: string | undefined,
): ReasoningEffort | undefined {
  if (!value) return undefined;
  const normalized = value.trim().toLowerCase();
  if (
    normalized === "low" ||
    normalized === "medium" ||
    normalized === "high"
  ) {
    return normalized;
  }
  return undefined;
}

function slugifyName(value: string): string {
  return (
    value
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "") || "ai-bot"
  );
}

function capitalize(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

function resolveSlotKey(): SlotKey {
  const raw = (process.env.AIBOT_SLOT ?? "").trim().toUpperCase();
  if (slotKeys.includes(raw as SlotKey)) return raw as SlotKey;
  return "A";
}

function resolveProviderName(slotKey: SlotKey): string {
  const explicit = readSlotEnv(slotKey, "PROVIDER", "").toLowerCase();
  if (explicit && explicit !== "default") return explicit;
  return (process.env.DEFAULT_PROVIDER ?? "groq").trim().toLowerCase();
}

function resolveProviderBaseUrl(providerName: string): string {
  const envKey = `${providerName.toUpperCase()}_BASE_URL`;
  const explicit = (process.env[envKey] ?? "").trim();
  if (explicit) return explicit;
  const builtin = KNOWN_PROVIDER_URLS[providerName];
  if (builtin) return builtin;
  throw new Error(
    `Unknown provider "${providerName}" and no ${envKey} configured. ` +
      `Known providers: ${Object.keys(KNOWN_PROVIDER_URLS).join(", ")}`,
  );
}

function resolveProviderApiKey(providerName: string): string {
  const envKey = `${providerName.toUpperCase()}_API_KEY`;
  const explicit = (process.env[envKey] ?? "").trim();
  if (explicit) return explicit;
  const openaiKey = (process.env.OPENAI_API_KEY ?? "").trim();
  if (openaiKey) return openaiKey;
  return "";
}

function resolveSlotConfig(slotKey: SlotKey): SlotConfig {
  const providerName = resolveProviderName(slotKey);
  const modelAlias = readSlotEnv(slotKey, "MODEL", "");
  if (!modelAlias) {
    throw new Error(
      `Missing AIBOT_${slotKey}_MODEL in environment. ` +
        `Configure a model alias for slot ${slotKey}.`,
    );
  }
  const upperAlias = modelAlias.toUpperCase();
  const modelId = readModelEnv(modelAlias, "ID", "");
  if (!modelId) {
    throw new Error(
      `Missing MODEL_${upperAlias}_ID in environment. ` +
        `Define the actual model identifier for alias "${modelAlias}".`,
    );
  }
  const baseUrl = resolveProviderBaseUrl(providerName);
  const apiKey = resolveProviderApiKey(providerName);
  const label = `${capitalize(providerName)}-${capitalize(modelAlias)}`;

  return {
    slotKey,
    providerName,
    modelAlias,
    modelId,
    label,
    baseUrl,
    apiKey,
    temperature:
      parseFloatEnv(readModelEnv(modelAlias, "TEMPERATURE", "")) ?? 0.4,
    maxCompletionTokens:
      parseIntegerEnv(readModelEnv(modelAlias, "MAX_COMPLETION_TOKENS", "")) ??
      220,
    includeReasoning: parseBooleanEnv(
      readModelEnv(modelAlias, "INCLUDE_REASONING", ""),
    ),
    reasoningEffort: parseReasoningEffortEnv(
      readModelEnv(modelAlias, "REASONING_EFFORT", ""),
    ),
    trait: readSlotEnv(slotKey, "TRAIT", "curious") as SlotConfig["trait"],
    mission: readSlotEnv(slotKey, "MISSION", "balanced"),
    includeExploredMemory:
      parseBooleanEnv(readSlotEnv(slotKey, "INCLUDE_EXPLORED_MEMORY", "")) ??
      true,
  };
}

function estimateTokenCount(text: string): number {
  return Math.ceil(text.length / 4);
}

const slot = (process.env.AIBOT_SLOT ?? "").trim().toUpperCase();
const config = resolveSlotConfig(resolveSlotKey());
const hasLLM = config.apiKey.length > 0;
const botLabel = slot ? `${config.label}-${slot}` : config.label;
const heroSlug = slugifyName(botLabel);
const heroName = botLabel;

const openai = hasLLM
  ? new OpenAI({ apiKey: config.apiKey, baseURL: config.baseUrl })
  : null;

if (!hasLLM) {
  console.warn(
    `[AIBot] No API key found for provider "${config.providerName}" ` +
      `(${config.providerName.toUpperCase()}_API_KEY). ` +
      "Running with heuristic fallback.",
  );
}

const promptDebugSlot = (process.env.AIBOT_DEBUG_PROMPT_SLOT ?? "")
  .trim()
  .toUpperCase();
const promptDebugTurn = Number.parseInt(
  (process.env.AIBOT_DEBUG_PROMPT_TURN ?? "").trim(),
  10,
);
const promptDebugFile =
  (
    process.env.AIBOT_DEBUG_PROMPT_FILE ?? "tmp/aibot-prompt-debug.json"
  ).trim() || "tmp/aibot-prompt-debug.json";
let promptDebugCaptured = false;

const SYSTEM_PROMPT = `You are AIBot, an AI hero choosing one legal action at a time from the latest observation.

GAME RULES
- Use only the latest observed state and the legal actions provided.
- Choose exactly one action from the legal actions list. Never invent actions.
- The map is a grid. Walls block movement. Doors may be open, closed, or locked.
- Move, attack, interact, use_item, rest, and wait are the only action kinds.
- Closed doors open when moving through them is legal. Locked doors and locked chests need a key.
- Hazards matter: lava deals 10 damage, traps injure when triggered, poison and blindness can affect later turns.
- Monsters threaten adjacent tiles during resolve. Low HP, fatigue, bad effects, and bad positioning matter.
- Potions, antidotes, keys, scrolls, and equipment only matter if they appear in your inventory or legal actions.
- Shrines, merchants, and prisoners only matter when visible and interact is legal.

CURRENT MISSION
${
  config.mission === "combat"
    ? "Lean toward taking strong fights, but do not throw away the hero when survival is clearly bad."
    : config.mission === "escape"
      ? "Lean toward safe movement and disengagement whenever a fight is unnecessary."
      : "Play a balanced turn: stay alive, avoid obvious blunders, and take good tactical opportunities."
}

RESPONSE FORMAT
Respond in plain text only, no JSON and no markdown fences.
Use exactly this format:
ACTION: <index>
REASON: <brief 1-sentence explanation>

Where <index> is the 0-based index into the legal actions list.

TACTICAL HEURISTICS
- Prefer immediate score or survival gains that are already legal this turn over speculative pathing.
- If a visible monster can punish your next position, treat that as a real cost.
- Use the tactical priorities and explored memory sections as compact hints, but legal actions remain authoritative.`;

function tileKey(x: number, y: number): string {
  return `${x},${y}`;
}

function recordExploredTiles(vision: VisionData): void {
  for (const tile of vision.visibleTiles) {
    exploredTiles.set(tileKey(tile.x, tile.y), {
      kind: tile.kind,
      turnSeen: vision.turn,
    });
  }
}

function manhattanDistance(
  a: { x: number; y: number },
  b: { x: number; y: number },
): number {
  return Math.abs(a.x - b.x) + Math.abs(a.y - b.y);
}

function describeSurvivalPosture(hero: HeroProfile): string {
  const hpRatio = hero.stats.maxHp > 0 ? hero.stats.hp / hero.stats.maxHp : 0;
  if (hpRatio <= 0.35) return "critical HP, survival first";
  if (hero.fatigue >= 75) return "severely fatigued, avoid greedy fights";
  if (hero.effects.some((effect) => effect.kind === "poison")) {
    return "poisoned, reduce incoming risk";
  }
  if (hero.effects.some((effect) => effect.kind === "blind")) {
    return "blind, expect reduced visibility";
  }
  return "stable, can take tactical opportunities";
}

function describeTacticalPriorities(vision: VisionData): string {
  const lines: string[] = [];
  const hero = vision.hero;
  const underfootItem = vision.visibleItems.find(
    (item) =>
      item.position.x === hero.position.x &&
      item.position.y === hero.position.y,
  );
  if (underfootItem) {
    lines.push(
      `- Item underfoot: ${underfootItem.item.name} (${underfootItem.item.description})`,
    );
  }

  const highValueMoves = vision.legalActions.filter(
    (action) =>
      action.kind === "move" &&
      (action.description.includes("treasure +10") ||
        action.description.includes("ESCAPE the dungeon") ||
        action.description.includes("health potion") ||
        action.description.includes("open locked chest") ||
        action.description.includes("opens door")),
  );
  if (highValueMoves.length > 0) {
    lines.push(
      `- Best immediate moves: ${highValueMoves
        .slice(0, 3)
        .map((action) => action.description)
        .join(" | ")}`,
    );
  }

  const nearestMonster = vision.visibleMonsters
    .map((monster) => ({
      monster,
      distance: manhattanDistance(hero.position, monster.position),
    }))
    .sort((left, right) => left.distance - right.distance)[0];
  if (nearestMonster) {
    lines.push(
      `- Nearest threat: ${nearestMonster.monster.name} ${nearestMonster.monster.kind} at distance ${nearestMonster.distance} (${nearestMonster.monster.hp}/${nearestMonster.monster.maxHp} HP)`,
    );
  }

  lines.push(`- Survival posture: ${describeSurvivalPosture(hero)}`);
  return lines.join("\n");
}

function describeExploredMemory(hero: HeroProfile): string {
  if (!config.includeExploredMemory) return "Disabled by config.";
  if (exploredTiles.size === 0) return "No explored memory yet.";

  const remembered = Array.from(exploredTiles.entries()).map(([key, value]) => {
    const [xText, yText] = key.split(",");
    return {
      x: Number.parseInt(xText ?? "0", 10),
      y: Number.parseInt(yText ?? "0", 10),
      kind: value.kind,
      turnSeen: value.turnSeen,
    };
  });

  const notableKinds = new Set<VisionTile["kind"]>([
    "door_closed",
    "door_locked",
    "chest",
    "chest_locked",
    "treasure",
    "potion",
    "shrine",
    "merchant",
    "exit",
    "trap_visible",
    "trap_triggered",
    "lava",
    "shallow_water",
  ]);

  const notable = remembered
    .filter((tile) => notableKinds.has(tile.kind))
    .sort((left, right) => {
      const leftDistance = manhattanDistance(hero.position, left);
      const rightDistance = manhattanDistance(hero.position, right);
      if (leftDistance !== rightDistance) return leftDistance - rightDistance;
      return right.turnSeen - left.turnSeen;
    })
    .slice(0, MAX_EXPLORED_MEMORY_LINES)
    .map(
      (tile) =>
        `- ${tile.kind} at (${tile.x},${tile.y}), seen on turn ${tile.turnSeen}, distance ${manhattanDistance(hero.position, tile)}`,
    );

  const exploredCount = remembered.length;
  const knownFrontierCount = remembered.filter(
    (tile) => tile.kind === "floor",
  ).length;
  if (notable.length === 0) {
    return [
      `Tracked tiles: ${exploredCount}`,
      `Known floor memory: ${knownFrontierCount}`,
      "No notable remembered tiles yet.",
    ].join("\n");
  }

  return [
    `Tracked tiles: ${exploredCount}`,
    `Known floor memory: ${knownFrontierCount}`,
    ...notable,
  ].join("\n");
}

function shouldCapturePrompt(vision: VisionData): boolean {
  if (promptDebugCaptured) return false;
  if (promptDebugSlot && slot !== promptDebugSlot) return false;
  if (
    !Number.isNaN(promptDebugTurn) &&
    promptDebugTurn > 0 &&
    vision.turn !== promptDebugTurn
  ) {
    return false;
  }
  return true;
}

function writePromptDebugFile(payload: Record<string, unknown>): void {
  const filePath = resolve(process.cwd(), promptDebugFile);
  mkdirSync(dirname(filePath), { recursive: true });
  writeFileSync(filePath, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
}

function renderMiniMap(
  tiles: VisionTile[],
  hero: HeroProfile,
  monsters: Monster[],
  npcs: Npc[],
  items: FloorItem[],
): string {
  if (tiles.length === 0) return "(no vision)";
  const xs = tiles.map((t) => t.x);
  const ys = tiles.map((t) => t.y);
  const minX = Math.min(...xs);
  const maxX = Math.max(...xs);
  const minY = Math.min(...ys);
  const maxY = Math.max(...ys);
  const charMap: Record<string, string> = {
    floor: ".",
    wall: "#",
    door_closed: "D",
    door_locked: "L",
    door_open: "/",
    trap_hidden: ".",
    trap_visible: "^",
    trap_triggered: "x",
    chest: "$",
    chest_locked: "¤",
    chest_open: "_",
    treasure: "*",
    potion: "!",
    shrine: "S",
    merchant: "M",
    exit: "E",
    shallow_water: "~",
    lava: "≈",
  };

  const grid: string[][] = [];
  for (let y = minY; y <= maxY; y++) {
    const row: string[] = [];
    for (let x = minX; x <= maxX; x++) row.push(" ");
    grid.push(row);
  }

  for (const tile of tiles) {
    grid[tile.y - minY][tile.x - minX] = charMap[tile.kind] ?? "?";
  }
  for (const monster of monsters) {
    const row = monster.position.y - minY;
    const col = monster.position.x - minX;
    if (row >= 0 && row < grid.length && col >= 0 && col < grid[0].length) {
      grid[row][col] = monster.kind[0].toUpperCase();
    }
  }
  for (const npc of npcs) {
    const row = npc.position.y - minY;
    const col = npc.position.x - minX;
    if (row >= 0 && row < grid.length && col >= 0 && col < grid[0].length) {
      grid[row][col] =
        npc.kind === "merchant" ? "M" : npc.kind === "shrine" ? "S" : "P";
    }
  }
  for (const item of items) {
    const row = item.position.y - minY;
    const col = item.position.x - minX;
    if (row >= 0 && row < grid.length && col >= 0 && col < grid[0].length) {
      grid[row][col] = "i";
    }
  }
  grid[hero.position.y - minY][hero.position.x - minX] = "@";
  return grid.map((row) => row.join("")).join("\n");
}

function describeHero(hero: HeroProfile): string {
  const equipment = [
    hero.equipment.weapon ? `Weapon: ${hero.equipment.weapon.name}` : null,
    hero.equipment.armor ? `Armor: ${hero.equipment.armor.name}` : null,
    hero.equipment.accessory
      ? `Accessory: ${hero.equipment.accessory.name}`
      : null,
  ]
    .filter(Boolean)
    .join(", ");
  const effects = hero.effects.length
    ? hero.effects
        .map((effect) => `${effect.kind}(${effect.turnsRemaining}t)`)
        .join(", ")
    : "none";
  const inventory = hero.inventory.length
    ? hero.inventory.map((item) => item.name).join(", ")
    : "empty";
  return [
    `HP: ${hero.stats.hp}/${hero.stats.maxHp} | ATK: ${hero.stats.attack} DEF: ${hero.stats.defense} SPD: ${hero.stats.speed} PER: ${hero.stats.perception}`,
    `Position: (${hero.position.x},${hero.position.y}) | Gold: ${hero.gold} | Status: ${hero.status}`,
    `Fatigue: ${hero.fatigue}/100 | Morale: ${hero.morale}/100 | Trait: ${hero.trait}`,
    `Last action: ${hero.lastAction}`,
    `Effects: ${effects}`,
    `Equipment: ${equipment || "none"}`,
    `Inventory: ${inventory}`,
  ].join("\n");
}

function describeVisibleHeroes(heroes: HeroProfile[], selfId: string): string {
  const otherHeroes = heroes.filter((hero) => hero.id !== selfId);
  if (otherHeroes.length === 0) return "No other heroes visible.";
  return otherHeroes
    .map(
      (hero) =>
        `- ${hero.name} at (${hero.position.x},${hero.position.y}) HP ${hero.stats.hp}/${hero.stats.maxHp} status=${hero.status}`,
    )
    .join("\n");
}

function describeBoardState(vision: VisionData): string {
  const phase = vision.turnState.phase;
  const phaseLeftMs = Math.max(0, vision.turnState.phaseEndsAt - Date.now());
  return [
    `Board: ${vision.boardId} | Status: ${vision.boardStatus}`,
    `Turn: ${vision.turn} | Phase: ${phase} | Time left: ${phaseLeftMs}ms`,
    `Seed: ${vision.seed}`,
    `Visible tiles: ${vision.visibleTiles.length} | Visible monsters: ${vision.visibleMonsters.length} | Visible items: ${vision.visibleItems.length}`,
  ].join("\n");
}

function describeMonsters(monsters: Monster[]): string {
  if (monsters.length === 0) return "None visible.";
  return monsters
    .map(
      (monster) =>
        `- ${monster.name} (${monster.kind}) at (${monster.position.x},${monster.position.y}): ${monster.hp}/${monster.maxHp} HP, ATK ${monster.attack} DEF ${monster.defense}, behavior=${monster.behavior}`,
    )
    .join("\n");
}

function describeNpcs(npcs: Npc[]): string {
  if (npcs.length === 0) return "None visible.";
  return npcs
    .map(
      (npc) =>
        `- ${npc.name} (${npc.kind}) at (${npc.position.x},${npc.position.y})`,
    )
    .join("\n");
}

function describeItems(items: FloorItem[]): string {
  if (items.length === 0) return "None visible.";
  return items
    .map(
      (item) =>
        `- ${item.item.name} at (${item.position.x},${item.position.y}): ${item.item.description}`,
    )
    .join("\n");
}

function describeEvents(events: EventRecord[]): string {
  if (events.length === 0) return "Nothing recent.";
  return events.map((event) => `[${event.type}] ${event.summary}`).join("\n");
}

function describeActions(actions: LegalAction[]): string {
  return actions
    .map((action, index) => `  [${index}] ${action.description}`)
    .join("\n");
}

function describeMemory(): string {
  if (memory.length === 0) return "No previous turns.";
  return memory
    .slice(-8)
    .map(
      (entry) => `  Turn ${entry.turn}: ${entry.action} — ${entry.reasoning}`,
    )
    .join("\n");
}

function describeLandmarks(
  landmarks: Landmark[] | undefined,
  hero: HeroProfile,
): string {
  if (!landmarks || landmarks.length === 0) return "No landmarks available.";
  return landmarks
    .map(
      (lm) =>
        `- ${lm.name} (${lm.kind}) at (${lm.position.x},${lm.position.y}), distance ${manhattanDistance(hero.position, lm.position)}`,
    )
    .join("\n");
}

function describeAllHeroPositions(
  positions:
    | { id: string; name: string; position: { x: number; y: number } }[]
    | undefined,
  selfId: string,
  selfPosition: { x: number; y: number },
): string {
  if (!positions || positions.length === 0)
    return "No player positions available.";
  return (
    positions
      .filter((p) => p.id !== selfId)
      .map(
        (p) =>
          `- ${p.name} at (${p.position.x},${p.position.y}), distance ${manhattanDistance(selfPosition, p.position)}`,
      )
      .join("\n") || "No other players visible."
  );
}

function buildUserPrompt(vision: VisionData): string {
  const sections: string[] = [
    `## LATEST GAME STATE`,
    `### BOARD STATE\n${describeBoardState(vision)}`,
    `### YOUR HERO\n${describeHero(vision.hero)}`,
    `### TACTICAL PRIORITIES\n${describeTacticalPriorities(vision)}`,
    `### VISIBLE OTHER HEROES\n${describeVisibleHeroes(vision.visibleHeroes, vision.hero.id)}`,
    `### MAP (@ = you, # = wall, . = floor, D = door, L = locked door, $ = chest, * = treasure, E = exit, ~ = water, ≈ = lava, ^ = trap, S = shrine, M = merchant, P = prisoner, i = item, UPPERCASE = monster first letter)\n${renderMiniMap(vision.visibleTiles, vision.hero, vision.visibleMonsters, vision.visibleNpcs, vision.visibleItems)}`,
    `### MONSTERS\n${describeMonsters(vision.visibleMonsters)}`,
    `### NPCS\n${describeNpcs(vision.visibleNpcs)}`,
    `### FLOOR ITEMS\n${describeItems(vision.visibleItems)}`,
    `### RECENT EVENTS\n${describeEvents(vision.recentEvents)}`,
  ];

  if (vision.landmarks && vision.landmarks.length > 0) {
    sections.push(
      `### MAP LANDMARKS (shared intel — same for all bots)\n${describeLandmarks(vision.landmarks, vision.hero)}`,
    );
  }

  if (vision.allHeroPositions && vision.allHeroPositions.length > 0) {
    sections.push(
      `### ALL PLAYER POSITIONS\n${describeAllHeroPositions(vision.allHeroPositions, vision.hero.id, vision.hero.position)}`,
    );
  }

  sections.push(
    `### EXPLORED MEMORY\n${describeExploredMemory(vision.hero)}`,
    `### YOUR RECENT MEMORY\n${describeMemory()}`,
    `### LEGAL ACTIONS (pick one by index)\n${describeActions(vision.legalActions)}`,
    `Respond in plain text using:\nACTION: <index>\nREASON: <why>`,
  );

  return sections.join("\n\n");
}

function normalizeActionText(value: string): string {
  return value
    .toLowerCase()
    .replace(/```(?:text|json)?/gi, " ")
    .replace(/[{}\[\]():,]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function matchActionObject(
  actions: LegalAction[],
  candidate: Partial<HeroAction> | null | undefined,
): LegalAction | undefined {
  if (!candidate?.kind) return undefined;
  return actions.find((action) => {
    if (action.kind !== candidate.kind) return false;
    if (candidate.direction && action.direction !== candidate.direction) {
      return false;
    }
    if (candidate.targetId && action.targetId !== candidate.targetId) {
      return false;
    }
    if (candidate.itemId && action.itemId !== candidate.itemId) return false;
    return true;
  });
}

function matchActionText(
  actions: LegalAction[],
  rawText: string,
): LegalAction | undefined {
  const text = normalizeActionText(rawText);
  if (!text) return undefined;

  const indexMatch = text.match(/\b(?:index|action)?\s*(\d+)\b/);
  if (indexMatch) {
    const index = Number.parseInt(indexMatch[1] ?? "", 10);
    if (!Number.isNaN(index) && index >= 0 && index < actions.length) {
      return actions[index];
    }
  }

  for (const direction of ["north", "south", "east", "west"] as const) {
    if (text.includes("move") && text.includes(direction)) {
      return actions.find(
        (action) => action.kind === "move" && action.direction === direction,
      );
    }
  }

  if (text.includes("rest")) {
    return actions.find((action) => action.kind === "rest");
  }
  if (text.includes("wait")) {
    return actions.find((action) => action.kind === "wait");
  }

  if (text.includes("attack")) {
    const attacks = actions.filter((action) => action.kind === "attack");
    if (attacks.length === 1) return attacks[0];
    const matchedAttack = attacks.find((action) =>
      normalizeActionText(action.description).includes(
        text.replace(/^attack\s+/, ""),
      ),
    );
    if (matchedAttack) return matchedAttack;
    if (attacks.length > 0) return attacks[0];
  }

  if (text.includes("use") || text.includes("equip") || text.includes("item")) {
    const useItems = actions.filter((action) => action.kind === "use_item");
    const matchedUseItem = useItems.find((action) =>
      normalizeActionText(action.description).includes(text),
    );
    if (matchedUseItem) return matchedUseItem;
    if (useItems.length === 1) return useItems[0];
  }

  if (
    text.includes("interact") ||
    text.includes("pray") ||
    text.includes("trade") ||
    text.includes("free")
  ) {
    const interacts = actions.filter((action) => action.kind === "interact");
    const matchedInteract = interacts.find((action) =>
      normalizeActionText(action.description).includes(text),
    );
    if (matchedInteract) return matchedInteract;
    if (interacts.length === 1) return interacts[0];
  }

  return actions.find((action) => {
    const description = normalizeActionText(action.description);
    return description.includes(text) || text.includes(description);
  });
}

function parseDecisionResponse(
  content: string,
  actions: LegalAction[],
): { action: HeroAction; reasoning: string } {
  const cleaned = content
    .trim()
    .replace(/^```(?:text|json)?\s*/i, "")
    .replace(/\s*```$/, "");

  const reasonMatch = cleaned.match(
    /(?:^|\n)\s*REASON(?:ING)?\s*:\s*([^\n]+)/i,
  );
  const reasoning = reasonMatch?.[1]?.trim() || "no reason";

  const actionIndexMatch = cleaned.match(/(?:^|\n)\s*ACTION\s*:\s*(\d+)\b/i);
  if (actionIndexMatch) {
    const index = Number.parseInt(actionIndexMatch[1] ?? "", 10);
    if (!Number.isNaN(index) && index >= 0 && index < actions.length) {
      return { action: actions[index], reasoning };
    }
  }

  const actionLineMatch = cleaned.match(/(?:^|\n)\s*ACTION\s*:\s*([^\n]+)/i);
  if (actionLineMatch) {
    const actionLine = actionLineMatch[1]?.trim() || "";
    const actionFromText = matchActionText(actions, actionLine);
    if (actionFromText) return { action: actionFromText, reasoning };
    try {
      const parsedLine = JSON.parse(actionLine) as
        | number
        | string
        | {
            action?: number | string | Partial<HeroAction>;
            kind?: HeroAction["kind"];
            direction?: HeroAction["direction"];
            targetId?: HeroAction["targetId"];
            itemId?: HeroAction["itemId"];
          };

      if (
        typeof parsedLine === "number" &&
        parsedLine >= 0 &&
        parsedLine < actions.length
      ) {
        return { action: actions[parsedLine], reasoning };
      }
      if (typeof parsedLine === "string") {
        const actionFromString = matchActionText(actions, parsedLine);
        if (actionFromString) return { action: actionFromString, reasoning };
      }
      const actionObject =
        typeof parsedLine === "object" && parsedLine !== null
          ? typeof parsedLine.action === "object" && parsedLine.action
            ? parsedLine.action
            : parsedLine
          : undefined;
      const matchedObjectAction = matchActionObject(actions, actionObject);
      if (matchedObjectAction) {
        return { action: matchedObjectAction, reasoning };
      }
    } catch {}
  }

  const firstJsonBlock = cleaned.match(/\{[\s\S]*\}/);
  if (firstJsonBlock) {
    try {
      const parsed = JSON.parse(firstJsonBlock[0]) as
        | {
            action?: number | string | Partial<HeroAction>;
            reason?: string;
            reasoning?: string;
            kind?: HeroAction["kind"];
            direction?: HeroAction["direction"];
            targetId?: HeroAction["targetId"];
            itemId?: HeroAction["itemId"];
          }
        | number
        | string;
      const parsedReason =
        typeof parsed === "object" && parsed !== null
          ? (parsed.reasoning ?? parsed.reason ?? reasoning)
          : reasoning;
      if (
        typeof parsed === "number" &&
        parsed >= 0 &&
        parsed < actions.length
      ) {
        return { action: actions[parsed], reasoning: parsedReason };
      }
      if (typeof parsed === "string") {
        const actionFromString = matchActionText(actions, parsed);
        if (actionFromString) {
          return { action: actionFromString, reasoning: parsedReason };
        }
      }
      const actionValue =
        typeof parsed === "object" && parsed !== null
          ? (parsed.action ?? parsed)
          : undefined;
      if (
        typeof actionValue === "number" &&
        actionValue >= 0 &&
        actionValue < actions.length
      ) {
        return { action: actions[actionValue], reasoning: parsedReason };
      }
      if (typeof actionValue === "string") {
        const actionFromString = matchActionText(actions, actionValue);
        if (actionFromString) {
          return { action: actionFromString, reasoning: parsedReason };
        }
      }
      if (typeof actionValue === "object" && actionValue !== null) {
        const matchedObjectAction = matchActionObject(actions, actionValue);
        if (matchedObjectAction) {
          return { action: matchedObjectAction, reasoning: parsedReason };
        }
      }
    } catch {}
  }

  const firstNumberMatch = cleaned.match(/\b(\d+)\b/);
  if (firstNumberMatch) {
    const index = Number.parseInt(firstNumberMatch[1] ?? "", 10);
    if (!Number.isNaN(index) && index >= 0 && index < actions.length) {
      return {
        action: actions[index],
        reasoning: cleaned.split(/\r?\n/)[0]?.trim() || reasoning,
      };
    }
  }

  const actionFromWholeText = matchActionText(actions, cleaned);
  if (actionFromWholeText) return { action: actionFromWholeText, reasoning };
  throw new Error(
    `could not parse action from model output: ${cleaned.slice(0, 160)}`,
  );
}

function formatCompletionDiagnostics(response: {
  choices?: Array<{
    finish_reason?: string | null;
    message?: { content?: string | null; reasoning?: string | null };
  }>;
  usage?: {
    prompt_tokens?: number;
    completion_tokens?: number;
    total_tokens?: number;
    completion_tokens_details?: { reasoning_tokens?: number };
  };
}): string {
  const choice = response.choices?.[0];
  const usage = response.usage;
  const contentLength = choice?.message?.content?.trim().length ?? 0;
  const reasoningLength = choice?.message?.reasoning?.trim().length ?? 0;
  const finishReason = choice?.finish_reason ?? "unknown";
  const promptTokens = usage?.prompt_tokens ?? 0;
  const completionTokens = usage?.completion_tokens ?? 0;
  const reasoningTokens =
    usage?.completion_tokens_details?.reasoning_tokens ?? 0;
  const totalTokens = usage?.total_tokens ?? 0;
  return [
    `finish_reason=${finishReason}`,
    `content_chars=${contentLength}`,
    `reasoning_chars=${reasoningLength}`,
    `prompt_tokens=${promptTokens}`,
    `completion_tokens=${completionTokens}`,
    `reasoning_tokens=${reasoningTokens}`,
    `total_tokens=${totalTokens}`,
  ].join(", ");
}

async function chooseAction(
  vision: VisionData,
  log: (msg: string) => void,
): Promise<{ action: HeroAction; reasoning: string }> {
  if (config.includeExploredMemory) {
    recordExploredTiles(vision);
  }

  if (!openai) {
    const fallback = pickFallback(vision);
    return { action: fallback, reasoning: "no LLM key, heuristic fallback" };
  }

  const userPrompt = buildUserPrompt(vision);
  const actions = vision.legalActions;
  const captureThisPrompt = shouldCapturePrompt(vision);
  const promptDebugPayload = captureThisPrompt
    ? {
        capturedAt: new Date().toISOString(),
        slot,
        slotKey: config.slotKey,
        provider: config.providerName,
        modelAlias: config.modelAlias,
        heroName,
        botLabel,
        modelId: config.modelId,
        mission: config.mission,
        config,
        includeExploredMemory: config.includeExploredMemory,
        boardId: vision.boardId,
        boardStatus: vision.boardStatus,
        turn: vision.turn,
        legalActionsCount: vision.legalActions.length,
        visibleTilesCount: vision.visibleTiles.length,
        visibleMonstersCount: vision.visibleMonsters.length,
        visibleHeroesCount: vision.visibleHeroes.length,
        visibleNpcsCount: vision.visibleNpcs.length,
        visibleItemsCount: vision.visibleItems.length,
        systemPromptChars: SYSTEM_PROMPT.length,
        userPromptChars: userPrompt.length,
        totalPromptChars: SYSTEM_PROMPT.length + userPrompt.length,
        systemPromptEstimatedTokens: estimateTokenCount(SYSTEM_PROMPT),
        userPromptEstimatedTokens: estimateTokenCount(userPrompt),
        totalPromptEstimatedTokens: estimateTokenCount(
          `${SYSTEM_PROMPT}\n\n${userPrompt}`,
        ),
        systemPrompt: SYSTEM_PROMPT,
        userPrompt,
      }
    : null;

  if (promptDebugPayload) {
    promptDebugCaptured = true;
    writePromptDebugFile({
      status: "captured-before-request",
      ...promptDebugPayload,
    });
    log(
      `prompt debug captured for slot ${slot || "?"} turn ${vision.turn} -> ${promptDebugFile}`,
    );
  }

  try {
    const request: OpenAI.Chat.ChatCompletionCreateParamsNonStreaming = {
      model: config.modelId,
      messages: [
        { role: "system", content: SYSTEM_PROMPT },
        { role: "user", content: userPrompt },
      ],
      stream: false,
      temperature: config.temperature,
      max_completion_tokens: config.maxCompletionTokens,
      ...(config.includeReasoning !== undefined
        ? { include_reasoning: config.includeReasoning }
        : {}),
      ...(config.reasoningEffort
        ? { reasoning_effort: config.reasoningEffort }
        : {}),
    };

    const response = await openai.chat.completions.create(request);
    const content = response.choices[0]?.message?.content?.trim() ?? "";
    const reasoningText = (
      (
        response.choices[0]?.message as
          | { reasoning?: string | null }
          | undefined
      )?.reasoning ?? ""
    ).trim();

    if (promptDebugPayload) {
      writePromptDebugFile({
        status: "captured-with-response",
        ...promptDebugPayload,
        promptTokens: response.usage?.prompt_tokens ?? null,
        completionTokens: response.usage?.completion_tokens ?? null,
        totalTokens: response.usage?.total_tokens ?? null,
        reasoningTokens:
          response.usage?.completion_tokens_details?.reasoning_tokens ?? null,
        finishReason: response.choices[0]?.finish_reason ?? null,
        contentChars: content.length,
        reasoningChars: reasoningText.length,
        contentPreview: content.slice(0, 280),
      });
    }

    if (!content) {
      throw new Error(
        `empty model response (${formatCompletionDiagnostics(response)})`,
      );
    }

    let parsed: { action: HeroAction; reasoning: string };
    try {
      parsed = parseDecisionResponse(content, actions);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      throw new Error(`${msg} (${formatCompletionDiagnostics(response)})`);
    }
    return {
      action: parsed.action,
      reasoning: parsed.reasoning ?? "no reason",
    };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    log(`LLM error: ${msg}`);
    const fallback = pickFallback(vision);
    return {
      action: fallback,
      reasoning: `LLM failed (${msg}), using fallback`,
    };
  }
}

function pickFallback(vision: VisionData): HeroAction {
  const actions = vision.legalActions;
  const hero = vision.hero;
  if (hero.stats.hp < hero.stats.maxHp * 0.4) {
    const potion = actions.find(
      (action) =>
        action.kind === "use_item" &&
        action.description.includes("Health Potion"),
    );
    if (potion) return potion;
  }
  const attack = actions.find((action) => action.kind === "attack");
  if (attack) return attack;
  const interact = actions.find((action) => action.kind === "interact");
  if (interact) return interact;
  const moves = actions.filter((action) => action.kind === "move");
  if (moves.length > 0) return moves[Math.floor(Math.random() * moves.length)];
  return actions.find((action) => action.kind === "rest") ?? actions[0];
}

let planned: { action: HeroAction; reasoning: string } | null = null;
let lastTurn = 0;
let terminalLogged = false;

await runHeroBot(
  {
    id: `aibot-${randomUUID()}`,
    name: heroName,
    strategy:
      `${config.label} agent [${heroSlug}] (${config.modelId}) - ` +
      `mission=${config.mission}, trait=${config.trait}, temp=${config.temperature}, ` +
      `max_completion_tokens=${config.maxCompletionTokens}` +
      (config.reasoningEffort
        ? `, reasoning_effort=${config.reasoningEffort}`
        : "") +
      (config.includeReasoning !== undefined
        ? `, include_reasoning=${config.includeReasoning}`
        : ""),
    preferredTrait: config.trait,
  },
  async ({ api, turnState, vision, log }) => {
    const submitPlanned = async (): Promise<void> => {
      if (!planned) return;
      const { action } = planned;
      planned = null;
      const result = await api.act(action);
      log(`submitted: ${action.kind} -> ${result.message}`);
    };

    if (turnState.turn !== lastTurn) {
      planned = null;
      lastTurn = turnState.turn;
    }

    if (turnState.phase === "submit") {
      if (planned) {
        await submitPlanned();
        return;
      }

      const currentVision = vision ?? (await api.observe());
      if (currentVision.hero.status !== "alive") {
        planned = null;
        if (!terminalLogged) {
          log(
            `${currentVision.hero.status} - final score: ${currentVision.hero.score}, kills: ${currentVision.hero.kills}, explored: ${currentVision.hero.tilesExplored}`,
          );
          terminalLogged = true;
        }
        return;
      }
      terminalLogged = false;

      log(
        `Turn ${currentVision.turn} | HP ${currentVision.hero.stats.hp}/${currentVision.hero.stats.maxHp} | ` +
          `Score ${currentVision.hero.score} | Kills ${currentVision.hero.kills} | ` +
          `Pos (${currentVision.hero.position.x},${currentVision.hero.position.y}) | ` +
          `${currentVision.legalActions.length} actions available`,
      );
      log("thinking...");

      const result = await chooseAction(currentVision, log);
      planned = result;

      log(
        `decided: ${result.action.kind}${result.action.direction ? ` ${result.action.direction}` : ""} - ${result.reasoning}`,
      );

      memory.push({
        turn: currentVision.turn,
        action: `${result.action.kind}${result.action.direction ? ` ${result.action.direction}` : ""}`,
        reasoning: result.reasoning,
      });
      if (memory.length > MAX_MEMORY) memory.shift();

      await submitPlanned();
    }
  },
);
