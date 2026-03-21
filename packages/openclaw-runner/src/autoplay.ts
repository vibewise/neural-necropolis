import { config as loadEnv } from "dotenv";
import { randomUUID } from "node:crypto";
import { spawn } from "node:child_process";
import { access } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { runHeroBot } from "@neural-necropolis/agent-sdk";
import type {
  Direction,
  EventRecord,
  FloorItem,
  HeroProfile,
  HeroRegistration,
  HeroTrait,
  Landmark,
  LegalAction,
  Monster,
  Npc,
  VisionData,
  VisionTile,
} from "@neural-necropolis/protocol-ts";

const moduleDir = path.dirname(fileURLToPath(import.meta.url));
loadEnv({ path: path.resolve(moduleDir, "../../../.env") });
loadEnv({ path: path.resolve(moduleDir, "../.env"), override: true });

type ParsedArgs = {
  options: Record<string, string | boolean>;
};

type HeroPersona = "scout" | "raider" | "slayer" | "warden";

type WorkerConfig = {
  baseUrl?: string;
  session: string;
  slug: string;
  name: string;
  heroId: string;
  persona: HeroPersona;
  trait: HeroTrait;
  strategy: string;
  sessionId: string;
  thinking: "off" | "minimal" | "low" | "medium" | "high" | "xhigh";
  timeoutSeconds: number;
  local: boolean;
};

type TurnMemory = { turn: number; action: string; reasoning: string };
type ExploredTileMemory = { kind: VisionTile["kind"]; turnSeen: number };

const DEFAULT_SESSION = "default";
const DEFAULT_PERSONA: HeroPersona = "raider";
const VALID_PERSONAS: readonly HeroPersona[] = [
  "scout",
  "raider",
  "slayer",
  "warden",
];
const VALID_THINKING: readonly WorkerConfig["thinking"][] = [
  "off",
  "minimal",
  "low",
  "medium",
  "high",
  "xhigh",
];
const PERSONA_PRESETS: Record<
  HeroPersona,
  { trait: HeroTrait; strategy: string; mission: string }
> = {
  scout: {
    trait: "curious",
    strategy:
      "explore aggressively, reveal new tiles, avoid unnecessary fights, and escape if cornered",
    mission:
      "Reveal new tiles, keep safe mobility, avoid bad trades, and only commit to fights when they are clearly favorable.",
  },
  raider: {
    trait: "greedy",
    strategy:
      "loot treasure and chests, stay alive, and extract with valuables",
    mission:
      "Favor treasure, chests, and profitable interactions, but do not die for marginal value.",
  },
  slayer: {
    trait: "aggressive",
    strategy:
      "hunt nearby monsters, keep initiative, and use potions only when needed",
    mission:
      "Pressure nearby monsters, convert safe attacks, and keep tempo without throwing the hero away.",
  },
  warden: {
    trait: "resilient",
    strategy:
      "survive first, avoid traps, rest early, and only fight on favorable terms",
    mission:
      "Prioritize survival, healing, and clean positioning over greed or speculative fights.",
  },
};

const turnMemory: TurnMemory[] = [];
const exploredTiles = new Map<string, ExploredTileMemory>();
const MAX_MEMORY = 20;
const MAX_EXPLORED_MEMORY_LINES = 10;
const DEFAULT_TIMEOUT_SECONDS = 20;

function parseArgs(argv: string[]): ParsedArgs {
  const options: Record<string, string | boolean> = {};
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (!token.startsWith("--")) continue;
    const key = token.slice(2);
    const next = argv[index + 1];
    if (!next || next.startsWith("--")) {
      options[key] = true;
      continue;
    }
    options[key] = next;
    index += 1;
  }
  return { options };
}

function getStringOption(
  options: Record<string, string | boolean>,
  key: string,
): string | undefined {
  const value = options[key];
  return typeof value === "string" ? value.trim() : undefined;
}

function hasFlag(
  options: Record<string, string | boolean>,
  key: string,
): boolean {
  return options[key] === true;
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

function parseTimeoutSeconds(raw: string | undefined): number {
  const parsed = Number.parseInt(raw ?? "", 10);
  if (!Number.isFinite(parsed) || parsed < 1) return DEFAULT_TIMEOUT_SECONDS;
  return parsed;
}

function parseBooleanEnv(value: string | undefined): boolean | null {
  if (!value) return null;
  const normalized = value.trim().toLowerCase();
  if (["1", "true", "yes", "on"].includes(normalized)) return true;
  if (["0", "false", "no", "off"].includes(normalized)) return false;
  return null;
}

function resolvePersona(value: string | undefined): HeroPersona {
  if (!value) return DEFAULT_PERSONA;
  const persona = value.trim().toLowerCase() as HeroPersona;
  if (VALID_PERSONAS.includes(persona)) return persona;
  throw new Error(
    `Invalid persona "${value}". Expected one of: ${VALID_PERSONAS.join(", ")}.`,
  );
}

function resolveThinking(value: string | undefined): WorkerConfig["thinking"] {
  if (!value) return "minimal";
  const thinking = value.trim().toLowerCase() as WorkerConfig["thinking"];
  if (VALID_THINKING.includes(thinking)) return thinking;
  throw new Error(
    `Invalid thinking level "${value}". Expected one of: ${VALID_THINKING.join(", ")}.`,
  );
}

function buildWorkerConfig(
  options: Record<string, string | boolean>,
): WorkerConfig {
  const session = sanitizeSession(
    getStringOption(options, "session") ?? DEFAULT_SESSION,
  );
  const slug = sanitizeSession(
    getStringOption(options, "slug") ??
      (session === DEFAULT_SESSION ? "openclaw-raider" : session),
  );
  const persona = resolvePersona(getStringOption(options, "persona"));
  const preset = PERSONA_PRESETS[persona];
  const heroId =
    sanitizeSession(
      getStringOption(options, "hero-id") ?? `openclaw-${slug}`,
    ) || `openclaw-${randomUUID()}`;
  const envLocal = parseBooleanEnv(process.env.OPENCLAW_AGENT_LOCAL);
  return {
    baseUrl: getStringOption(options, "base-url"),
    session,
    slug,
    name: getStringOption(options, "name") ?? buildDefaultHeroName(slug),
    heroId,
    persona,
    trait: preset.trait,
    strategy: preset.strategy,
    sessionId: getStringOption(options, "session-id") ?? `nn-${session}`,
    thinking: resolveThinking(
      getStringOption(options, "thinking") ?? process.env.OPENCLAW_THINKING,
    ),
    timeoutSeconds: parseTimeoutSeconds(
      getStringOption(options, "timeout") ??
        process.env.OPENCLAW_AGENT_TIMEOUT_S,
    ),
    local:
      hasFlag(options, "local") ||
      envLocal === true ||
      (envLocal === null && process.platform === "win32"),
  };
}

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

function rememberTurn(
  turn: number,
  action: LegalAction,
  reasoning: string,
): void {
  turnMemory.push({ turn, action: action.description, reasoning });
  if (turnMemory.length > MAX_MEMORY) {
    turnMemory.splice(0, turnMemory.length - MAX_MEMORY);
  }
}

function manhattanDistance(
  a: { x: number; y: number },
  b: { x: number; y: number },
): number {
  return Math.abs(a.x - b.x) + Math.abs(a.y - b.y);
}

function renderMiniMap(
  tiles: VisionTile[],
  hero: HeroProfile,
  monsters: Monster[],
  npcs: Npc[],
  items: FloorItem[],
): string {
  if (tiles.length === 0) return "(no vision)";
  const xs = tiles.map((tile) => tile.x);
  const ys = tiles.map((tile) => tile.y);
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
  for (let y = minY; y <= maxY; y += 1) {
    const row: string[] = [];
    for (let x = minX; x <= maxX; x += 1) row.push(" ");
    grid.push(row);
  }
  for (const tile of tiles) {
    grid[tile.y - minY][tile.x - minX] = charMap[tile.kind] ?? "?";
  }
  for (const monster of monsters) {
    const row = monster.position.y - minY;
    const col = monster.position.x - minX;
    if (grid[row]?.[col] !== undefined) {
      grid[row][col] = monster.kind[0]?.toUpperCase() ?? "M";
    }
  }
  for (const npc of npcs) {
    const row = npc.position.y - minY;
    const col = npc.position.x - minX;
    if (grid[row]?.[col] !== undefined) {
      grid[row][col] =
        npc.kind === "merchant" ? "M" : npc.kind === "shrine" ? "S" : "P";
    }
  }
  for (const item of items) {
    const row = item.position.y - minY;
    const col = item.position.x - minX;
    if (grid[row]?.[col] !== undefined) {
      grid[row][col] = "i";
    }
  }
  grid[hero.position.y - minY][hero.position.x - minX] = "@";
  return grid.map((row) => row.join("")).join("\n");
}

function describeBoardState(vision: VisionData): string {
  const phase = vision.turnState?.phase ?? "unknown";
  const phaseLeftMs = vision.turnState
    ? Math.max(0, vision.turnState.phaseEndsAt - Date.now())
    : 0;
  return [
    `Board: ${vision.boardId ?? "unknown"} | Status: ${vision.boardStatus ?? "unknown"}`,
    `Turn: ${vision.turn} | Phase: ${phase} | Time left: ${phaseLeftMs}ms`,
    `Seed: ${vision.seed}`,
    `Visible tiles: ${vision.visibleTiles.length} | Visible monsters: ${vision.visibleMonsters.length} | Visible items: ${vision.visibleItems.length}`,
  ].join("\n");
}

function describeHero(hero: HeroProfile): string {
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
    `Inventory: ${inventory}`,
  ].join("\n");
}

function describeMonsters(monsters: Monster[]): string {
  if (monsters.length === 0) return "None visible.";
  return monsters
    .slice(0, 8)
    .map(
      (monster) =>
        `- ${monster.name} (${monster.kind}) at (${monster.position.x},${monster.position.y}): ${monster.hp}/${monster.maxHp} HP, ATK ${monster.attack} DEF ${monster.defense}, behavior=${monster.behavior}`,
    )
    .join("\n");
}

function describeNpcs(npcs: Npc[]): string {
  if (npcs.length === 0) return "None visible.";
  return npcs
    .slice(0, 6)
    .map(
      (npc) =>
        `- ${npc.name} (${npc.kind}) at (${npc.position.x},${npc.position.y})`,
    )
    .join("\n");
}

function describeItems(items: FloorItem[]): string {
  if (items.length === 0) return "None visible.";
  return items
    .slice(0, 8)
    .map(
      (item) =>
        `- ${item.item.name} at (${item.position.x},${item.position.y}): ${item.item.description}`,
    )
    .join("\n");
}

function describeEvents(events: EventRecord[]): string {
  if (events.length === 0) return "Nothing recent.";
  return events
    .slice(-6)
    .map((event) => `[${event.type}] ${event.summary}`)
    .join("\n");
}

function describeActions(actions: LegalAction[]): string {
  return actions
    .map((action, index) => `  [${index}] ${action.description}`)
    .join("\n");
}

function describeLandmarks(
  landmarks: Landmark[] | undefined,
  hero: HeroProfile,
): string {
  if (!landmarks || landmarks.length === 0) return "No landmarks available.";
  return landmarks
    .map(
      (landmark) =>
        `- ${landmark.name} (${landmark.kind}) at (${landmark.position.x},${landmark.position.y}), distance ${manhattanDistance(hero.position, landmark.position)}`,
    )
    .join("\n");
}

function describeExploredMemory(hero: HeroProfile): string {
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
  return notable.length > 0
    ? notable.join("\n")
    : "No notable remembered tiles yet.";
}

function describeRecentMemory(): string {
  if (turnMemory.length === 0) return "No previous turns.";
  return turnMemory
    .slice(-8)
    .map(
      (entry) => `  Turn ${entry.turn}: ${entry.action} — ${entry.reasoning}`,
    )
    .join("\n");
}

function buildPrompt(vision: VisionData, config: WorkerConfig): string {
  const mission = PERSONA_PRESETS[config.persona].mission;
  const sections = [
    "You are controlling one Neural Necropolis hero through OpenClaw.",
    `Persona: ${config.persona}. Mission: ${mission}`,
    "Rules: choose exactly one legal action by index. Never invent actions. Legal actions are authoritative. Prefer survival over greed when the hero is fragile.",
    "Respond in plain text only using exactly:",
    "ACTION_INDEX: <index>",
    "REASON: <one short sentence>",
    "",
    "## LATEST GAME STATE",
    `### BOARD STATE\n${describeBoardState(vision)}`,
    `### YOUR HERO\n${describeHero(vision.hero)}`,
    `### MAP (@ = you, # = wall, . = floor, D = door, L = locked door, / = open door, $ = chest, * = treasure, E = exit, ~ = water, ≈ = lava, ^ = trap, S = shrine, M = merchant, P = prisoner, i = item, UPPERCASE = monster first letter)\n${renderMiniMap(vision.visibleTiles, vision.hero, vision.visibleMonsters, vision.visibleNpcs, vision.visibleItems)}`,
    `### MONSTERS\n${describeMonsters(vision.visibleMonsters)}`,
    `### NPCS\n${describeNpcs(vision.visibleNpcs)}`,
    `### FLOOR ITEMS\n${describeItems(vision.visibleItems)}`,
    `### RECENT EVENTS\n${describeEvents(vision.recentEvents)}`,
    `### EXPLORED MEMORY\n${describeExploredMemory(vision.hero)}`,
    `### YOUR RECENT MEMORY\n${describeRecentMemory()}`,
  ];
  if (vision.landmarks && vision.landmarks.length > 0) {
    sections.push(
      `### LANDMARKS\n${describeLandmarks(vision.landmarks, vision.hero)}`,
    );
  }
  sections.push(`### LEGAL ACTIONS\n${describeActions(vision.legalActions)}`);
  return sections.join("\n\n");
}

function moveTarget(
  position: { x: number; y: number },
  direction: Direction | undefined,
): { x: number; y: number } {
  if (direction === "north") return { x: position.x, y: position.y - 1 };
  if (direction === "south") return { x: position.x, y: position.y + 1 };
  if (direction === "east") return { x: position.x + 1, y: position.y };
  if (direction === "west") return { x: position.x - 1, y: position.y };
  return position;
}

function pickFallbackAction(
  vision: VisionData,
  persona: HeroPersona,
): { action: LegalAction; reasoning: string } {
  const actions = vision.legalActions;
  const hero = vision.hero;
  const potion = actions.find(
    (action) =>
      action.kind === "use_item" &&
      action.description.includes("Health Potion"),
  );
  if (hero.stats.hp < hero.stats.maxHp * 0.4 && potion) {
    return { action: potion, reasoning: "low HP fallback heal" };
  }
  const attack = actions.find((action) => action.kind === "attack");
  if (persona === "slayer" && attack) {
    return { action: attack, reasoning: "slayer fallback attack" };
  }
  const interact = actions.find((action) => action.kind === "interact");
  if (persona === "raider" && interact) {
    return { action: interact, reasoning: "raider fallback interact" };
  }
  const rest = actions.find((action) => action.kind === "rest");
  if (persona === "warden" && rest && hero.stats.hp < hero.stats.maxHp * 0.7) {
    return { action: rest, reasoning: "warden fallback rest" };
  }
  const moves = actions.filter((action) => action.kind === "move");
  if (persona === "scout") {
    const unseenMove = moves.find((action) => {
      const target = moveTarget(hero.position, action.direction);
      return !exploredTiles.has(tileKey(target.x, target.y));
    });
    if (unseenMove) {
      return {
        action: unseenMove,
        reasoning: "scout fallback unexplored move",
      };
    }
  }
  if (attack) return { action: attack, reasoning: "generic fallback attack" };
  if (interact) {
    return { action: interact, reasoning: "generic fallback interact" };
  }
  if (moves.length > 0) {
    return { action: moves[0], reasoning: "generic fallback move" };
  }
  if (rest) return { action: rest, reasoning: "generic fallback rest" };
  return {
    action: actions[0],
    reasoning: "generic fallback first legal action",
  };
}

async function canAccess(filePath: string): Promise<boolean> {
  try {
    await access(filePath);
    return true;
  } catch {
    return false;
  }
}

function splitPathEntries(value: string): string[] {
  return value.split(path.delimiter).filter(Boolean);
}

async function resolveOpenClawCommand(): Promise<{
  command: string;
  argsPrefix: string[];
}> {
  const explicitEntry = (process.env.OPENCLAW_CLI_ENTRY ?? "").trim();
  if (explicitEntry && (await canAccess(explicitEntry))) {
    return { command: process.execPath, argsPrefix: [explicitEntry] };
  }

  const entryCandidates: string[] = [];
  const seen = new Set<string>();
  const addCandidate = (candidate: string) => {
    const normalized = path.normalize(candidate);
    if (!seen.has(normalized)) {
      seen.add(normalized);
      entryCandidates.push(normalized);
    }
  };

  if (process.env.APPDATA) {
    addCandidate(
      path.join(
        process.env.APPDATA,
        "npm",
        "node_modules",
        "openclaw",
        "openclaw.mjs",
      ),
    );
  }

  for (const entry of splitPathEntries(process.env.PATH ?? "")) {
    addCandidate(path.join(entry, "node_modules", "openclaw", "openclaw.mjs"));
    addCandidate(
      path.join(entry, "..", "node_modules", "openclaw", "openclaw.mjs"),
    );
  }

  for (const candidate of entryCandidates) {
    if (await canAccess(candidate)) {
      return { command: process.execPath, argsPrefix: [candidate] };
    }
  }

  if (process.platform !== "win32") {
    return { command: "openclaw", argsPrefix: [] };
  }

  throw new Error(
    "Unable to locate OpenClaw CLI entrypoint. Set OPENCLAW_CLI_ENTRY to the installed openclaw.mjs path.",
  );
}

function runOpenClawAgent(
  config: WorkerConfig,
  prompt: string,
): Promise<string> {
  return new Promise((resolve, reject) => {
    void (async () => {
      const openclaw = await resolveOpenClawCommand();
      const args = [
        ...openclaw.argsPrefix,
        "agent",
        "--session-id",
        config.sessionId,
        "--message",
        prompt,
        "--thinking",
        config.thinking,
        "--timeout",
        String(config.timeoutSeconds),
        "--json",
      ];
      if (config.local) args.push("--local");
      const child = spawn(openclaw.command, args, {
        cwd: process.env.TEMP ?? process.cwd(),
        env: process.env,
        shell: false,
        stdio: ["ignore", "pipe", "pipe"],
      });
      let stdout = "";
      let stderr = "";
      const timeoutHandle = setTimeout(
        () => {
          child.kill();
          reject(
            new Error(
              `openclaw agent timed out after ${config.timeoutSeconds}s`,
            ),
          );
        },
        config.timeoutSeconds * 1000 + 1000,
      );
      child.stdout.on("data", (chunk) => {
        stdout += chunk.toString();
      });
      child.stderr.on("data", (chunk) => {
        stderr += chunk.toString();
      });
      child.on("error", (error) => {
        clearTimeout(timeoutHandle);
        reject(error);
      });
      child.on("exit", (code) => {
        clearTimeout(timeoutHandle);
        if (code === 0) {
          resolve(stdout.trim());
          return;
        }
        reject(
          new Error(
            `openclaw agent exited with code ${code}: ${stderr.trim() || stdout.trim()}`,
          ),
        );
      });
    })().catch(reject);
  });
}

function parseJsonEnvelope(raw: string): unknown {
  const trimmed = raw.trim();
  if (!trimmed) return null;
  try {
    return JSON.parse(trimmed);
  } catch {
    const start = trimmed.indexOf("{");
    const end = trimmed.lastIndexOf("}");
    if (start >= 0 && end > start) {
      try {
        return JSON.parse(trimmed.slice(start, end + 1));
      } catch {
        return null;
      }
    }
    return null;
  }
}

function extractTextParts(value: unknown): string[] {
  if (typeof value === "string") return [value];
  if (!value || typeof value !== "object") return [];
  if (Array.isArray(value)) {
    return value.flatMap((entry) => extractTextParts(entry));
  }
  const record = value as Record<string, unknown>;
  const parts: string[] = [];
  for (const key of ["text", "message", "content", "body"]) {
    if (typeof record[key] === "string") {
      parts.push(record[key] as string);
    }
  }
  for (const child of Object.values(record)) {
    if (child && typeof child === "object") {
      parts.push(...extractTextParts(child));
    }
  }
  return parts;
}

function parseActionIndex(
  rawReply: string,
  actions: LegalAction[],
): number | null {
  const envelope = parseJsonEnvelope(rawReply);
  const candidateText = [rawReply, ...extractTextParts(envelope)].join("\n");
  const patterns = [
    /ACTION_INDEX\s*:\s*(\d+)/i,
    /ACTION\s*:\s*(\d+)/i,
    /\bindex\s*(\d+)\b/i,
  ];
  for (const pattern of patterns) {
    const match = candidateText.match(pattern);
    if (!match) continue;
    const index = Number.parseInt(match[1] ?? "", 10);
    if (Number.isFinite(index) && index >= 0 && index < actions.length) {
      return index;
    }
  }
  return null;
}

function parseReasoning(rawReply: string): string {
  const envelope = parseJsonEnvelope(rawReply);
  const candidateText = [rawReply, ...extractTextParts(envelope)].join("\n");
  const reasonMatch = candidateText.match(/REASON\s*:\s*(.+)/i);
  return reasonMatch?.[1]?.trim() || "selected by OpenClaw";
}

async function chooseAction(
  vision: VisionData,
  config: WorkerConfig,
): Promise<{ action: LegalAction; reasoning: string }> {
  const prompt = buildPrompt(vision, config);
  try {
    const rawReply = await runOpenClawAgent(config, prompt);
    const index = parseActionIndex(rawReply, vision.legalActions);
    if (index !== null) {
      return {
        action: vision.legalActions[index],
        reasoning: parseReasoning(rawReply),
      };
    }
    throw new Error(`Could not parse action index from reply: ${rawReply}`);
  } catch (error) {
    const fallback = pickFallbackAction(vision, config.persona);
    const message = error instanceof Error ? error.message : String(error);
    console.error(
      `[openclaw-bot ${config.session}] OpenClaw turn failed: ${message}`,
    );
    return {
      action: fallback.action,
      reasoning: `${fallback.reasoning}; OpenClaw fallback after ${message}`,
    };
  }
}

async function main(): Promise<void> {
  const parsed = parseArgs(process.argv.slice(2));
  const config = buildWorkerConfig(parsed.options);
  const registration: HeroRegistration = {
    id: config.heroId,
    name: config.name,
    strategy: `OpenClaw ${config.persona} - ${config.strategy}`,
    preferredTrait: config.trait,
  };
  console.log(
    `[openclaw-bot ${config.session}] persona=${config.persona} thinking=${config.thinking} local=${config.local ? "on" : "off"}`,
  );
  await runHeroBot(
    registration,
    async ({ api, turnState, vision, log }) => {
      if (turnState.phase !== "submit") return;
      const currentVision = vision ?? (await api.observe());
      if (currentVision.hero.status !== "alive") return;
      if (currentVision.legalActions.length === 0) {
        log("no legal actions available");
        return;
      }
      recordExploredTiles(currentVision);
      const { action, reasoning } = await chooseAction(currentVision, config);
      const result = await api.act(action);
      rememberTurn(currentVision.turn, action, reasoning);
      log(`${action.description} -> ${result.message} | ${reasoning}`);
    },
    config.baseUrl,
  );
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  process.stderr.write(`${message}\n`);
  process.exitCode = 1;
});
