export type EntityId = string;
export type Direction = "north" | "south" | "east" | "west";
export type TurnPhase = "submit" | "resolve";
export type BoardLifecycle = "queued" | "open" | "running" | "completed";
export type HeroStatus = "alive" | "dead" | "escaped";
export type HeroSessionStatus = "active" | "expired";

export type TurnState = {
  turn: number;
  phase: TurnPhase;
  started: boolean;
  submitWindowMs: number;
  resolveWindowMs: number;
  phaseEndsAt: number;
  phaseDurationMs: number;
  phaseElapsedMs: number;
  seed: string;
};

export type Position = { x: number; y: number };

export type TileKind =
  | "floor"
  | "wall"
  | "door_closed"
  | "door_locked"
  | "door_open"
  | "trap_hidden"
  | "trap_visible"
  | "trap_triggered"
  | "chest"
  | "chest_locked"
  | "chest_open"
  | "treasure"
  | "potion"
  | "shrine"
  | "merchant"
  | "exit"
  | "shallow_water"
  | "lava";

export type GameMap = {
  width: number;
  height: number;
  tiles: TileKind[][];
};

export type EffectKind =
  | "poison"
  | "stun"
  | "shield"
  | "haste"
  | "regen"
  | "blind";

export type StatusEffect = {
  kind: EffectKind;
  turnsRemaining: number;
  magnitude: number;
};

export type ItemSlot = "weapon" | "armor" | "accessory";

export type ItemKind =
  | "health_potion"
  | "antidote"
  | "key"
  | "scroll_reveal"
  | "scroll_teleport"
  | "sword"
  | "dagger"
  | "axe"
  | "staff"
  | "leather_armor"
  | "chain_armor"
  | "plate_armor"
  | "ring_vision"
  | "amulet_protection"
  | "boots_speed";

export type StatBonus = Partial<{
  maxHp: number;
  attack: number;
  defense: number;
  speed: number;
  perception: number;
}>;

export type Item = {
  id: EntityId;
  kind: ItemKind;
  name: string;
  slot?: ItemSlot;
  statBonus?: StatBonus;
  value: number;
  consumable: boolean;
  description: string;
};

export type FloorItem = {
  id: EntityId;
  item: Item;
  position: Position;
};

export type HeroTrait =
  | "aggressive"
  | "cautious"
  | "greedy"
  | "curious"
  | "resilient";

export type HeroStats = {
  maxHp: number;
  hp: number;
  attack: number;
  defense: number;
  speed: number;
  perception: number;
};

export type HeroProfile = {
  id: EntityId;
  name: string;
  strategy: string;
  trait: HeroTrait;
  stats: HeroStats;
  baseStats: HeroStats;
  position: Position;
  score: number;
  kills: number;
  tilesExplored: number;
  gold: number;
  inventory: Item[];
  equipment: {
    weapon: Item | null;
    armor: Item | null;
    accessory: Item | null;
  };
  effects: StatusEffect[];
  fatigue: number;
  morale: number;
  status: HeroStatus;
  lastAction: string;
  turnsSurvived: number;
};

export type HeroRegistration = {
  id: EntityId;
  name: string;
  strategy: string;
  preferredTrait?: HeroTrait;
};

export type MonsterKind =
  | "goblin"
  | "skeleton"
  | "orc"
  | "dragon"
  | "wraith"
  | "spider"
  | "mimic";

export type MonsterBehavior = "patrol" | "chase" | "ambush" | "guard" | "flee";

export type Monster = {
  id: EntityId;
  kind: MonsterKind;
  name: string;
  hp: number;
  maxHp: number;
  attack: number;
  defense: number;
  speed: number;
  xpReward: number;
  goldDrop: number;
  behavior: MonsterBehavior;
  position: Position;
  effects: StatusEffect[];
  drops: ItemKind[];
  alertRange: number;
};

export type NpcKind = "merchant" | "shrine" | "prisoner";

export type Npc = {
  id: EntityId;
  kind: NpcKind;
  name: string;
  position: Position;
  inventory?: Item[];
  interactedBy: EntityId[];
};

export type QuestObjective =
  | { type: "kill"; monsterKind: MonsterKind; count: number; progress: number }
  | { type: "rescue"; npcId: EntityId; done: boolean };

export type Quest = {
  id: EntityId;
  heroId: EntityId;
  description: string;
  objective: QuestObjective;
  reward: { score: number; gold: number; item?: ItemKind };
  completed: boolean;
};

export type ActionKind =
  | "move"
  | "attack"
  | "rest"
  | "use_item"
  | "interact"
  | "wait"
  | "cast_spell";

export type SpellKind =
  | "locate_treasury"
  | "locate_monsters"
  | "locate_heroes"
  | "locate_buildings"
  | "locate_prisoner";

export type HeroAction = {
  kind: ActionKind;
  direction?: Direction;
  targetId?: EntityId;
  itemId?: EntityId;
  spellKind?: SpellKind;
};

export type SpellDiscovery = {
  spell: SpellKind;
  positions: Position[];
  discoveredTurn: number;
  mobile: boolean;
};

export type LegalAction = HeroAction & { description: string };

export type EventType =
  | "combat"
  | "movement"
  | "death"
  | "loot"
  | "spawn"
  | "trap"
  | "interaction"
  | "effect"
  | "quest"
  | "system";

export type EventRecord = {
  id: EntityId;
  turn: number;
  type: EventType;
  summary: string;
};

export type VisionTile = { x: number; y: number; kind: TileKind };

export type Landmark = {
  kind: string;
  name: string;
  position: Position;
};

export type GameSettings = {
  paused: boolean;
};

export type VisionData = {
  seed: string;
  turn: number;
  boardId: string;
  boardStatus: BoardLifecycle;
  hero: HeroProfile;
  visibleTiles: VisionTile[];
  visibleMonsters: Monster[];
  visibleHeroes: HeroProfile[];
  visibleNpcs: Npc[];
  visibleItems: FloorItem[];
  recentEvents: EventRecord[];
  legalActions: LegalAction[];
  turnState: TurnState;
  spellDiscoveries?: SpellDiscovery[];
  gameSettings: GameSettings;
};

export type WorldState = {
  seed: string;
  dungeonName: string;
  turn: number;
  map: GameMap;
  monsters: Monster[];
  heroes: HeroProfile[];
  npcs: Npc[];
  floorItems: FloorItem[];
  quests: Quest[];
  events: EventRecord[];
  pendingActions: Record<EntityId, HeroAction>;
};

export type ScoreTrack = {
  heroId: EntityId;
  heroName: string;
  trait: HeroTrait;
  totalScore: number;
  combatScore: number;
  treasureScore: number;
  explorationScore: number;
  questScore: number;
  turnsSurvived: number;
  tilesExplored: number;
  monstersKilled: number;
  escaped: boolean;
  status: HeroStatus;
};

export type BotMessage = {
  id: EntityId;
  heroId: EntityId;
  heroName: string;
  turn: number;
  createdAt: number;
  message: string;
};

export type WorldSummary = {
  dungeonName: string;
  turn: number;
  mapWidth: number;
  mapHeight: number;
};

export type LobbyInfo = {
  boardId: string;
  boardSlug: string;
  boardName: string;
  attachedHeroes: number;
  maxHeroes: number;
  requiredHeroes: number | null;
  minHeroesToStart: number;
  canStart: boolean;
  canReset: boolean;
  queueStatus?: string;
  joinWindowRemainingMs?: number;
  status: BoardLifecycle;
  started: boolean;
  completionReason?: string;
};

export type BoardSnapshot = {
  seed: string;
  boardId: string;
  boardSlug: string;
  world: WorldSummary;
  heroes: HeroProfile[];
  leaderboard: ScoreTrack[];
  monsters: Monster[];
  npcs: Npc[];
  floorItems: FloorItem[];
  map: TileKind[][];
  recentEvents: EventRecord[];
  botMessages: BotMessage[];
  turnState: TurnState;
  lobby: LobbyInfo;
};

export type StoreSnapshot = BoardSnapshot;

export type DashboardResponse = BoardSnapshot & {
  gameSettings: GameSettings;
};

export type DashboardSnapshot = DashboardResponse;

export type BoardSummary = {
  boardId: string;
  boardSlug: string;
  boardName: string;
  status: BoardLifecycle;
  queueStatus?: string;
  joinWindowRemainingMs?: number;
  heroCount: number;
  maxHeroes: number;
  turn: number;
  seed: string;
  completionReason?: string;
};

export type ManagerSnapshot = {
  boards: BoardSummary[];
};

export type CompletedBoard = {
  boardId: string;
  boardSlug: string;
  boardName: string;
  turn: number;
  completionReason: string;
  seed: string;
  heroCount: number;
  monsterCount: number;
  topLeaderboard: ScoreTrack[];
};

export type CompletedBoardsResponse = {
  boards: CompletedBoard[];
  total: number;
  offset: number;
  limit: number;
};

export type HealthResponse = {
  ok: boolean;
  turnState: TurnState;
};

export type HeroLease = {
  leaseExpiresAt: number;
  leaseTtlMs: number;
  sessionStatus: HeroSessionStatus;
};

export type RegisterResponse = HeroLease & {
  id: string;
  name: string;
  trait: HeroTrait;
  strategy: string;
  stats: HeroStats;
  position: Position;
  boardId: string;
  sessionToken: string;
  requestId: string;
  turnState: TurnState;
};

export type ObserveResponse = VisionData &
  HeroLease & {
    requestId: string;
  };

export type HeartbeatResponse = HeroLease & {
  ok: true;
  boardId: string;
  requestId: string;
  turnState: TurnState;
};

export type ActionResponse = {
  accepted: boolean;
  message: string;
  requestId: string;
  replayed?: boolean;
  turnState: TurnState;
};

export type ActionConflictResponse = {
  error: "wrong_phase";
  message: string;
  turnState: TurnState;
};

export type HeroLogRequest = {
  message: string;
};

export type LogResponse = {
  ok: true;
  requestId: string;
};

export type LogErrorResponse = {
  ok: false;
};

export type LeaderboardResponse = {
  leaderboard: ScoreTrack[];
};

export type SeedResponse = {
  seed: string;
};

export type StreamEnvelope = {
  type: "snapshot" | "log";
  payload: DashboardResponse | string;
};

// ── Arena types ──

export type ArenaStatus = "pending" | "running" | "complete";
export type MatchStatus = "pending" | "running" | "complete";
export type DuelStatus = "pending" | "running" | "complete";

export type ArenaBotConfig = {
  label: string;
  provider: string;
  model: string;
  strategy: string;
  promptStyle?: "smart" | "naive";
  maxOutputTokens?: number;
  temperature?: number;
  reasoningEffort?: "low" | "medium" | "high";
};

export type DuelHeroTokenStats = {
  heroId: string;
  botIndex: number;
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
  llmCalls: number;
  fallbacks: number;
};

export type DuelResult = {
  duelIndex: number;
  status: DuelStatus;
  boardId: string;
  seed: string;
  maxTurns: number;
  leaderboard: ScoreTrack[];
  turnReached: number;
  completedAt?: number;
  botPositions: number[];
  tokenStats?: DuelHeroTokenStats[];
};

export type ArenaMatchSnapshot = {
  id: string;
  status: MatchStatus;
  seed: string;
  maxTurns: number;
  duelCount: number;
  duels: DuelResult[];
  createdAt: number;
  startedAt?: number;
  finishedAt?: number;
};

export type ArenaBotStanding = {
  botIndex: number;
  label: string;
  provider: string;
  model: string;
  wins: number;
  duelsPlayed: number;
  totalScore: number;
  totalPromptTokens: number;
  totalCompletionTokens: number;
  totalLlmCalls: number;
};

export type ArenaSnapshot = {
  id: string;
  name: string;
  status: ArenaStatus;
  bots: ArenaBotConfig[];
  matches: ArenaMatchSnapshot[];
  standings: ArenaBotStanding[];
  createdAt: number;
  startedAt?: number;
  finishedAt?: number;
  playersPerDuel: number;
};

export type ArenaSummary = {
  id: string;
  name: string;
  status: ArenaStatus;
  botCount: number;
  matchCount: number;
  playersPerDuel: number;
  createdAt: number;
};

export type ArenaListResponse = {
  arenas: ArenaSummary[];
};

export type CreateArenaRequest = {
  name: string;
  bots: ArenaBotConfig[];
  playersPerDuel?: number;
};

export type AddMatchRequest = {
  duelCount: number;
  maxTurns?: number;
};

export const CONFIG = {
  MAP_WIDTH: 48,
  MAP_HEIGHT: 32,
  ROOM_COUNT: 9,
  VISION_BASE: 3,

  HERO_BASE_STATS: {
    maxHp: 40,
    hp: 40,
    attack: 5,
    defense: 3,
    speed: 3,
    perception: 5,
  } satisfies HeroStats,

  TRAIT_BONUSES: {
    aggressive: { attack: 2, defense: -1 } as StatBonus,
    cautious: { defense: 2, maxHp: 10, perception: 1 } as StatBonus,
    greedy: { perception: 1, speed: 1 } as StatBonus,
    curious: { perception: 2, speed: 1 } as StatBonus,
    resilient: { maxHp: 15, defense: 1 } as StatBonus,
  },

  FATIGUE_PER_TURN: 1,
  FATIGUE_COMBAT_EXTRA: 1,
  FATIGUE_WATER_EXTRA: 2,
  FATIGUE_REST_REDUCTION: 8,
  FATIGUE_WAIT_REDUCTION: 2,
  FATIGUE_PENALTY_50: 1,
  FATIGUE_PENALTY_75: 2,
  FATIGUE_PENALTY_100: 3,
  FATIGUE_MAX: 100,

  MORALE_START: 50,
  MORALE_KILL: 5,
  MORALE_TREASURE: 3,
  MORALE_QUEST: 10,
  MORALE_SHRINE: 10,
  MORALE_DAMAGE: -2,
  MORALE_ALLY_DEATH: -5,
  MORALE_POISON: -3,
  MORALE_HIGH: 70,
  MORALE_HIGH_ATK: 1,
  MORALE_LOW: 30,
  MORALE_LOW_ATK: -1,
  MORALE_LOW_DEF: -1,
  MORALE_MAX: 100,
  MORALE_MIN: 0,

  REST_HEAL: 5,
  POTION_HEAL: 20,
  TRAP_DAMAGE: 8,
  TRAP_VISIBLE_DAMAGE: 4,
  LAVA_DAMAGE: 10,
  INVENTORY_LIMIT: 8,
  ESCAPE_BONUS: 50,
  TREASURE_SCORE: 10,
  EXPLORE_SCORE_DIVISOR: 10,
  SURVIVAL_SCORE_DIVISOR: 5,
  SHRINE_HEAL: 15,
  MONSTER_SPAWN_MIN: 4,
  MONSTER_SPAWN_CHANCE: 0.5,
  MAX_EVENTS: 80,
  PERCEPTION_TRAP_THRESHOLD: 7,
  SCROLL_REVEAL_RADIUS: 6,
} as const;
