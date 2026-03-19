export type EntityId = string;
export type Direction = "north" | "south" | "east" | "west";
export type TurnPhase = "submit" | "resolve";

export type TurnState = {
  turn: number;
  phase: TurnPhase;
  started: boolean;
  phaseEndsAt: number;
  phaseDurationMs: number;
  phaseElapsedMs: number;
  seed: string;
  warmupRemainingMs?: number;
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

/* ── Status effects ── */

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

/* ── Items ── */

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

/* ── Heroes ── */

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
  status: "alive" | "dead" | "escaped";
  lastAction: string;
  turnsSurvived: number;
};

export type HeroRegistration = {
  id: EntityId;
  name: string;
  strategy: string;
  preferredTrait?: HeroTrait;
};

/* ── Monsters ── */

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

/* ── NPCs ── */

export type NpcKind = "merchant" | "shrine" | "prisoner";

export type Npc = {
  id: EntityId;
  kind: NpcKind;
  name: string;
  position: Position;
  inventory?: Item[];
  interactedBy: EntityId[];
};

/* ── Quests ── */

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

/* ── Actions ── */

export type ActionKind =
  | "move"
  | "attack"
  | "rest"
  | "use_item"
  | "interact"
  | "wait";

export type HeroAction = {
  kind: ActionKind;
  direction?: Direction;
  targetId?: EntityId;
  itemId?: EntityId;
};

export type LegalAction = HeroAction & { description: string };

/* ── Events ── */

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

/* ── Vision ── */

export type VisionTile = { x: number; y: number; kind: TileKind };

export type Landmark = {
  kind: string;
  name: string;
  position: Position;
};

export type GameSettings = {
  includeLandmarks: boolean;
  includePlayerPositions: boolean;
  paused: boolean;
};

export type VisionData = {
  seed: string;
  turn: number;
  boardId?: string;
  boardStatus?: "queued" | "open" | "running" | "completed";
  hero: HeroProfile;
  visibleTiles: VisionTile[];
  visibleMonsters: Monster[];
  visibleHeroes: HeroProfile[];
  visibleNpcs: Npc[];
  visibleItems: FloorItem[];
  recentEvents: EventRecord[];
  legalActions: LegalAction[];
  turnState?: TurnState;
  landmarks?: Landmark[];
  allHeroPositions?: { id: string; name: string; position: Position }[];
  gameSettings?: GameSettings;
};

/* ── World state ── */

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

/* ── Scoring ── */

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
  status: "alive" | "dead" | "escaped";
};

export type BotMessage = {
  id: EntityId;
  heroId: EntityId;
  heroName: string;
  turn: number;
  createdAt: number;
  message: string;
};

export type LobbyInfo = {
  attachedHeroes: number;
  requiredHeroes: number | null;
  canStart: boolean;
  canReset: boolean;
  status: "lobby" | "running" | "completed";
  started: boolean;
  completionReason?: string;
};

/* ── Snapshots ── */

export type StoreSnapshot = {
  seed: string;
  world: {
    dungeonName: string;
    turn: number;
    mapWidth: number;
    mapHeight: number;
  };
  heroes: HeroProfile[];
  leaderboard: ScoreTrack[];
  monsters: Monster[];
  npcs: Npc[];
  floorItems: FloorItem[];
  map: TileKind[][];
  recentEvents: EventRecord[];
  botMessages: BotMessage[];
};

export type DashboardSnapshot = StoreSnapshot & {
  turnState: TurnState;
  lobby: LobbyInfo;
};

export type StreamEnvelope = {
  type: "snapshot" | "log";
  payload: DashboardSnapshot | string;
};

/* ── Game config ── */

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
