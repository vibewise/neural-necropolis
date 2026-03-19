import type {
  ItemKind,
  Item,
  MonsterKind,
  MonsterBehavior,
  NpcKind,
  ItemSlot,
  StatBonus,
} from "../types.js";

/* ── Monster templates ── */

type MonsterTemplate = {
  kind: MonsterKind;
  hp: number;
  attack: number;
  defense: number;
  speed: number;
  xpReward: number;
  goldDrop: number;
  behavior: MonsterBehavior;
  drops: ItemKind[];
  alertRange: number;
};

export const MONSTER_TEMPLATES: Record<MonsterKind, MonsterTemplate> = {
  goblin: {
    kind: "goblin",
    hp: 8,
    attack: 3,
    defense: 1,
    speed: 3,
    xpReward: 5,
    goldDrop: 3,
    behavior: "patrol",
    drops: [],
    alertRange: 5,
  },
  spider: {
    kind: "spider",
    hp: 6,
    attack: 4,
    defense: 0,
    speed: 4,
    xpReward: 4,
    goldDrop: 2,
    behavior: "ambush",
    drops: ["antidote"],
    alertRange: 3,
  },
  skeleton: {
    kind: "skeleton",
    hp: 12,
    attack: 4,
    defense: 2,
    speed: 2,
    xpReward: 8,
    goldDrop: 6,
    behavior: "guard",
    drops: ["key"],
    alertRange: 5,
  },
  wraith: {
    kind: "wraith",
    hp: 15,
    attack: 6,
    defense: 1,
    speed: 4,
    xpReward: 12,
    goldDrop: 8,
    behavior: "chase",
    drops: [],
    alertRange: 7,
  },
  orc: {
    kind: "orc",
    hp: 20,
    attack: 6,
    defense: 3,
    speed: 2,
    xpReward: 15,
    goldDrop: 12,
    behavior: "guard",
    drops: ["health_potion"],
    alertRange: 5,
  },
  mimic: {
    kind: "mimic",
    hp: 18,
    attack: 7,
    defense: 4,
    speed: 1,
    xpReward: 20,
    goldDrop: 20,
    behavior: "ambush",
    drops: ["key"],
    alertRange: 2,
  },
  dragon: {
    kind: "dragon",
    hp: 50,
    attack: 10,
    defense: 5,
    speed: 3,
    xpReward: 40,
    goldDrop: 30,
    behavior: "guard",
    drops: ["scroll_reveal", "health_potion"],
    alertRange: 6,
  },
};

export const MONSTER_NAMES: Record<MonsterKind, string[]> = {
  goblin: ["Snark", "Grik", "Blix", "Nub", "Fang", "Rot"],
  spider: ["Skitter", "Weaver", "Fangspinner", "Webmaw", "Lurk"],
  skeleton: ["Rattles", "Boneclaw", "Dustwalker", "Hollowgrin", "Ashbone"],
  wraith: ["Whisper", "Dreadshade", "Gloom", "Phantasm", "Void"],
  orc: ["Grom", "Thrak", "Brug", "Skull-Splitter", "Ironjaw"],
  mimic: ["Deceiver", "Greedmaw", "Trapjaw", "False-Hope"],
  dragon: ["Scorchfang", "Emberclaw", "Ashwing", "Doomscale"],
};

/* ── Item templates ── */

type ItemTemplate = {
  kind: ItemKind;
  name: string;
  slot?: ItemSlot;
  statBonus?: StatBonus;
  value: number;
  consumable: boolean;
  description: string;
};

export const ITEM_TEMPLATES: Record<ItemKind, ItemTemplate> = {
  health_potion: {
    kind: "health_potion",
    name: "Health Potion",
    value: 10,
    consumable: true,
    description: "Restores 20 HP",
  },
  antidote: {
    kind: "antidote",
    name: "Antidote",
    value: 8,
    consumable: true,
    description: "Cures poison",
  },
  key: {
    kind: "key",
    name: "Rusty Key",
    value: 5,
    consumable: true,
    description: "Opens a locked door or chest",
  },
  scroll_reveal: {
    kind: "scroll_reveal",
    name: "Scroll of Reveal",
    value: 15,
    consumable: true,
    description: "Reveals traps nearby",
  },
  scroll_teleport: {
    kind: "scroll_teleport",
    name: "Scroll of Teleport",
    value: 20,
    consumable: true,
    description: "Teleport to a random safe tile",
  },
  sword: {
    kind: "sword",
    name: "Iron Sword",
    value: 25,
    consumable: false,
    slot: "weapon",
    statBonus: { attack: 3 },
    description: "+3 ATK",
  },
  dagger: {
    kind: "dagger",
    name: "Shadow Dagger",
    value: 20,
    consumable: false,
    slot: "weapon",
    statBonus: { attack: 2, speed: 1 },
    description: "+2 ATK, +1 SPD",
  },
  axe: {
    kind: "axe",
    name: "Battle Axe",
    value: 30,
    consumable: false,
    slot: "weapon",
    statBonus: { attack: 5, speed: -1 },
    description: "+5 ATK, -1 SPD",
  },
  staff: {
    kind: "staff",
    name: "Seer's Staff",
    value: 22,
    consumable: false,
    slot: "weapon",
    statBonus: { attack: 1, perception: 3 },
    description: "+1 ATK, +3 PER",
  },
  leather_armor: {
    kind: "leather_armor",
    name: "Leather Armor",
    value: 20,
    consumable: false,
    slot: "armor",
    statBonus: { defense: 2 },
    description: "+2 DEF",
  },
  chain_armor: {
    kind: "chain_armor",
    name: "Chain Mail",
    value: 35,
    consumable: false,
    slot: "armor",
    statBonus: { defense: 4, speed: -1 },
    description: "+4 DEF, -1 SPD",
  },
  plate_armor: {
    kind: "plate_armor",
    name: "Plate Armor",
    value: 50,
    consumable: false,
    slot: "armor",
    statBonus: { defense: 6, speed: -2 },
    description: "+6 DEF, -2 SPD",
  },
  ring_vision: {
    kind: "ring_vision",
    name: "Ring of Far Sight",
    value: 30,
    consumable: false,
    slot: "accessory",
    statBonus: { perception: 4 },
    description: "+4 PER",
  },
  amulet_protection: {
    kind: "amulet_protection",
    name: "Amulet of Warding",
    value: 30,
    consumable: false,
    slot: "accessory",
    statBonus: { defense: 2, maxHp: 10 },
    description: "+2 DEF, +10 maxHP",
  },
  boots_speed: {
    kind: "boots_speed",
    name: "Boots of Haste",
    value: 28,
    consumable: false,
    slot: "accessory",
    statBonus: { speed: 3 },
    description: "+3 SPD",
  },
};

/* ── NPC names ── */

export const NPC_NAMES: Record<NpcKind, string[]> = {
  merchant: ["Grynn the Peddler", "Old Sacks", "Darkmarket Dez", "Fungal Finn"],
  shrine: [
    "Moonwell",
    "Altar of Light",
    "Emberstone Shrine",
    "Spirit Fountain",
  ],
  prisoner: ["Sir Aldric", "Wren the Scout", "Elder Mira", "Pip the Thief"],
};

/* ── Dungeon names ── */

export const DUNGEON_NAMES = [
  "Shadowkeep",
  "The Bone Pits",
  "Cryptfang Halls",
  "Embervault",
  "The Hollow",
  "Dreadmaze",
  "Fungal Depths",
  "Iron Tomb",
  "Whisperdeep",
  "The Sunken Vaults",
];

/* ── Merchant stock ── */

export const MERCHANT_STOCK: ItemKind[] = [
  "health_potion",
  "health_potion",
  "antidote",
  "key",
  "scroll_reveal",
  "scroll_teleport",
];

/* ── Room loot pools ── */

export const EQUIPMENT_POOL: ItemKind[] = [
  "sword",
  "dagger",
  "axe",
  "staff",
  "leather_armor",
  "chain_armor",
  "ring_vision",
  "boots_speed",
];

export const RARE_POOL: ItemKind[] = [
  "plate_armor",
  "amulet_protection",
  "axe",
  "chain_armor",
];
