import { randomUUID } from "node:crypto";
import { Rng } from "../rng.js";
import type {
  Direction,
  FloorItem,
  GameMap,
  Monster,
  Npc,
  Position,
  TileKind,
  WorldState,
} from "../types.js";
import { CONFIG } from "../types.js";
import {
  DUNGEON_NAMES,
  EQUIPMENT_POOL,
  ITEM_TEMPLATES,
  MERCHANT_STOCK,
  MONSTER_NAMES,
  MONSTER_TEMPLATES,
  NPC_NAMES,
  RARE_POOL,
} from "./data.js";

/* ── Helpers ── */

type RoomType =
  | "spawn"
  | "normal"
  | "treasure_vault"
  | "shrine_room"
  | "merchant_room"
  | "prison"
  | "boss_lair";

type Room = { x: number; y: number; w: number; h: number; type: RoomType };

function roomCenter(r: Room): Position {
  return { x: Math.floor(r.x + r.w / 2), y: Math.floor(r.y + r.h / 2) };
}

function roomsOverlap(a: Room, b: Room, pad = 2): boolean {
  return (
    a.x - pad < b.x + b.w + pad &&
    a.x + a.w + pad > b.x - pad &&
    a.y - pad < b.y + b.h + pad &&
    a.y + a.h + pad > b.y - pad
  );
}

function manhattan(a: Position, b: Position): number {
  return Math.abs(a.x - b.x) + Math.abs(a.y - b.y);
}

function makeItem(
  kind: (typeof EQUIPMENT_POOL)[number] | (typeof RARE_POOL)[number],
): FloorItem["item"] {
  const t = ITEM_TEMPLATES[kind];
  return { id: randomUUID(), ...t };
}

/* ── Corridor carving ── */

function carveCorridor(
  tiles: TileKind[][],
  from: Position,
  to: Position,
  corridorSet: Set<string>,
  rng: Rng,
): void {
  let { x, y } = from;
  const horizontal = rng.chance(0.5);

  if (horizontal) {
    while (x !== to.x) {
      if (tiles[y]?.[x] === "wall") {
        tiles[y][x] = "floor";
        corridorSet.add(`${x},${y}`);
      }
      x += x < to.x ? 1 : -1;
    }
    while (y !== to.y) {
      if (tiles[y]?.[x] === "wall") {
        tiles[y][x] = "floor";
        corridorSet.add(`${x},${y}`);
      }
      y += y < to.y ? 1 : -1;
    }
  } else {
    while (y !== to.y) {
      if (tiles[y]?.[x] === "wall") {
        tiles[y][x] = "floor";
        corridorSet.add(`${x},${y}`);
      }
      y += y < to.y ? 1 : -1;
    }
    while (x !== to.x) {
      if (tiles[y]?.[x] === "wall") {
        tiles[y][x] = "floor";
        corridorSet.add(`${x},${y}`);
      }
      x += x < to.x ? 1 : -1;
    }
  }
  if (tiles[to.y]?.[to.x] === "wall") {
    tiles[to.y][to.x] = "floor";
  }
}

/* ── Door placement ── */

function placeDoors(tiles: TileKind[][], rooms: Room[], rng: Rng): void {
  const H = tiles.length;
  const W = tiles[0].length;
  const dirs: [number, number][] = [
    [0, -1],
    [0, 1],
    [-1, 0],
    [1, 0],
  ];

  for (const room of rooms) {
    for (let y = room.y; y < room.y + room.h; y++) {
      for (let x = room.x; x < room.x + room.w; x++) {
        if (
          y !== room.y &&
          y !== room.y + room.h - 1 &&
          x !== room.x &&
          x !== room.x + room.w - 1
        )
          continue; // only edges

        if (tiles[y][x] !== "floor") continue;

        for (const [dx, dy] of dirs) {
          const nx = x + dx;
          const ny = y + dy;
          if (nx < 0 || nx >= W || ny < 0 || ny >= H) continue;
          if (tiles[ny][nx] !== "floor") continue;

          // Check if neighbor is outside this room
          const outside =
            nx < room.x ||
            nx >= room.x + room.w ||
            ny < room.y ||
            ny >= room.y + room.h;
          if (!outside) continue;

          // This is a room-corridor boundary
          if (rng.chance(0.4)) {
            if (room.type === "boss_lair" || room.type === "treasure_vault") {
              tiles[y][x] = rng.chance(0.5) ? "door_locked" : "door_closed";
            } else {
              tiles[y][x] = "door_closed";
            }
          }
          break; // one door per edge tile is enough
        }
      }
    }
  }
}

/* ── Trap placement ── */

function placeTraps(
  tiles: TileKind[][],
  corridorSet: Set<string>,
  rng: Rng,
): void {
  for (const key of corridorSet) {
    if (rng.chance(0.08)) {
      const [sx, sy] = key.split(",").map(Number);
      if (tiles[sy][sx] === "floor") {
        tiles[sy][sx] = "trap_hidden";
      }
    }
  }
}

/* ── Tile placement in rooms ── */

function placeInRoom(
  tiles: TileKind[][],
  room: Room,
  kind: TileKind,
  count: number,
  rng: Rng,
  used: Set<string>,
): void {
  let placed = 0;
  let attempts = 0;
  while (placed < count && attempts < 100) {
    const x = rng.int(room.x + 1, room.x + room.w - 2);
    const y = rng.int(room.y + 1, room.y + room.h - 2);
    const key = `${x},${y}`;
    if (tiles[y][x] === "floor" && !used.has(key)) {
      tiles[y][x] = kind;
      used.add(key);
      placed++;
    }
    attempts++;
  }
}

/* ── Monster spawning ── */

function spawnMonsters(
  rooms: Room[],
  tiles: TileKind[][],
  rng: Rng,
  used: Set<string>,
): Monster[] {
  const monsters: Monster[] = [];

  for (let i = 0; i < rooms.length; i++) {
    const room = rooms[i];
    if (
      room.type === "spawn" ||
      room.type === "shrine_room" ||
      room.type === "merchant_room"
    )
      continue;

    let kinds: (keyof typeof MONSTER_TEMPLATES)[];
    let count: number;

    if (room.type === "boss_lair") {
      kinds = ["dragon"];
      count = 1;
    } else if (room.type === "treasure_vault") {
      kinds = ["orc", "skeleton", "mimic"];
      count = rng.int(2, 3);
    } else if (room.type === "prison") {
      kinds = ["skeleton", "orc"];
      count = rng.int(1, 2);
    } else {
      kinds = ["goblin", "goblin", "spider", "skeleton"];
      count = rng.int(1, 3);
    }

    for (let m = 0; m < count; m++) {
      const kind = rng.pick(kinds);
      const tmpl = MONSTER_TEMPLATES[kind];
      let pos: Position | null = null;
      for (let a = 0; a < 40; a++) {
        const x = rng.int(room.x + 1, room.x + room.w - 2);
        const y = rng.int(room.y + 1, room.y + room.h - 2);
        const key = `${x},${y}`;
        if (tiles[y][x] === "floor" && !used.has(key)) {
          pos = { x, y };
          used.add(key);
          break;
        }
      }
      if (!pos) continue;

      monsters.push({
        id: randomUUID(),
        kind,
        name: rng.pick(MONSTER_NAMES[kind]),
        hp: tmpl.hp,
        maxHp: tmpl.hp,
        attack: tmpl.attack,
        defense: tmpl.defense,
        speed: tmpl.speed,
        xpReward: tmpl.xpReward,
        goldDrop: tmpl.goldDrop,
        behavior: tmpl.behavior,
        position: pos,
        effects: [],
        drops: [...tmpl.drops],
        alertRange: tmpl.alertRange,
      });
    }
  }
  return monsters;
}

/* ── NPC spawning ── */

function spawnNpcs(rooms: Room[], rng: Rng, used: Set<string>): Npc[] {
  const npcs: Npc[] = [];

  for (const room of rooms) {
    if (room.type === "shrine_room") {
      const c = roomCenter(room);
      npcs.push({
        id: randomUUID(),
        kind: "shrine",
        name: rng.pick(NPC_NAMES.shrine),
        position: c,
        interactedBy: [],
      });
      used.add(`${c.x},${c.y}`);
    } else if (room.type === "merchant_room") {
      const c = roomCenter(room);
      const stock = MERCHANT_STOCK.map((k) => ({
        id: randomUUID(),
        ...ITEM_TEMPLATES[k],
      }));
      npcs.push({
        id: randomUUID(),
        kind: "merchant",
        name: rng.pick(NPC_NAMES.merchant),
        position: c,
        inventory: stock,
        interactedBy: [],
      });
      used.add(`${c.x},${c.y}`);
    } else if (room.type === "prison") {
      const c = roomCenter(room);
      npcs.push({
        id: randomUUID(),
        kind: "prisoner",
        name: rng.pick(NPC_NAMES.prisoner),
        position: c,
        interactedBy: [],
      });
      used.add(`${c.x},${c.y}`);
    }
  }
  return npcs;
}

/* ── Floor item spawning ── */

function spawnFloorItems(
  rooms: Room[],
  tiles: TileKind[][],
  rng: Rng,
  used: Set<string>,
): FloorItem[] {
  const items: FloorItem[] = [];

  for (const room of rooms) {
    if (room.type === "spawn") continue;

    if (room.type === "treasure_vault") {
      for (let i = 0; i < rng.int(2, 3); i++) {
        const kind = rng.pick(EQUIPMENT_POOL);
        const pos = findFloorInRoom(room, tiles, rng, used);
        if (pos)
          items.push({ id: randomUUID(), item: makeItem(kind), position: pos });
      }
    } else if (room.type === "boss_lair") {
      const kind = rng.pick(RARE_POOL);
      const pos = findFloorInRoom(room, tiles, rng, used);
      if (pos)
        items.push({ id: randomUUID(), item: makeItem(kind), position: pos });
    } else if (room.type === "normal" && rng.chance(0.35)) {
      const kind = rng.pick([
        ...EQUIPMENT_POOL,
        "health_potion",
        "key",
      ] as const);
      const pos = findFloorInRoom(room, tiles, rng, used);
      if (pos)
        items.push({ id: randomUUID(), item: makeItem(kind), position: pos });
    }
  }
  return items;
}

function findFloorInRoom(
  room: Room,
  tiles: TileKind[][],
  rng: Rng,
  used: Set<string>,
): Position | null {
  for (let a = 0; a < 40; a++) {
    const x = rng.int(room.x + 1, room.x + room.w - 2);
    const y = rng.int(room.y + 1, room.y + room.h - 2);
    const key = `${x},${y}`;
    if (tiles[y][x] === "floor" && !used.has(key)) {
      used.add(key);
      return { x, y };
    }
  }
  return null;
}

/* ── Main generation ── */

export function generateDungeon(seed: string): WorldState {
  const rng = new Rng(seed);
  const W = CONFIG.MAP_WIDTH;
  const H = CONFIG.MAP_HEIGHT;

  const tiles: TileKind[][] = Array.from({ length: H }, () =>
    Array.from<TileKind>({ length: W }).fill("wall"),
  );

  // Generate rooms
  const rooms: Room[] = [];
  let attempts = 0;
  while (rooms.length < CONFIG.ROOM_COUNT && attempts < 600) {
    const w = rng.int(5, 9);
    const h = rng.int(5, 7);
    const x = rng.int(1, W - w - 1);
    const y = rng.int(1, H - h - 1);
    const candidate: Room = { x, y, w, h, type: "normal" };
    if (!rooms.some((r) => roomsOverlap(r, candidate))) {
      rooms.push(candidate);
    }
    attempts++;
  }

  if (rooms.length < 3) {
    // fallback: force a few rooms
    rooms.push({ x: 2, y: 2, w: 6, h: 5, type: "normal" });
    rooms.push({ x: 20, y: 10, w: 6, h: 5, type: "normal" });
    rooms.push({ x: 38, y: 22, w: 7, h: 6, type: "normal" });
  }

  // Assign room types
  rooms[0].type = "spawn";
  rooms[rooms.length - 1].type = "boss_lair";
  if (rooms.length > 3) rooms[rooms.length - 2].type = "treasure_vault";

  const normals = rooms.filter((r) => r.type === "normal");
  const shuffled = rng.shuffle(normals);
  if (shuffled.length > 0) shuffled[0].type = "shrine_room";
  if (shuffled.length > 1) shuffled[1].type = "merchant_room";
  if (shuffled.length > 2) shuffled[2].type = "prison";

  // Carve rooms
  for (const room of rooms) {
    for (let y = room.y; y < room.y + room.h; y++) {
      for (let x = room.x; x < room.x + room.w; x++) {
        tiles[y][x] = "floor";
      }
    }
  }

  // Connect rooms with corridors
  const corridorSet = new Set<string>();
  for (let i = 0; i < rooms.length - 1; i++) {
    carveCorridor(
      tiles,
      roomCenter(rooms[i]),
      roomCenter(rooms[i + 1]),
      corridorSet,
      rng,
    );
  }
  // Extra connectivity
  if (rooms.length > 5) {
    carveCorridor(
      tiles,
      roomCenter(rooms[0]),
      roomCenter(rooms[Math.floor(rooms.length / 2)]),
      corridorSet,
      rng,
    );
  }

  // Doors, traps
  placeDoors(tiles, rooms, rng);
  placeTraps(tiles, corridorSet, rng);

  // Used-position tracker
  const used = new Set<string>();

  // Treasure & potion tiles
  for (const room of rooms) {
    if (room.type === "treasure_vault") {
      placeInRoom(tiles, room, "treasure", rng.int(3, 5), rng, used);
      placeInRoom(tiles, room, "chest", rng.int(1, 2), rng, used);
      placeInRoom(tiles, room, "chest_locked", rng.int(0, 1), rng, used);
    } else if (room.type === "boss_lair") {
      placeInRoom(tiles, room, "treasure", rng.int(1, 2), rng, used);
      placeInRoom(tiles, room, "chest_locked", 1, rng, used);
    } else if (
      room.type !== "spawn" &&
      room.type !== "shrine_room" &&
      room.type !== "merchant_room"
    ) {
      if (rng.chance(0.5))
        placeInRoom(tiles, room, "treasure", rng.int(1, 2), rng, used);
      if (rng.chance(0.4)) placeInRoom(tiles, room, "potion", 1, rng, used);
    }
  }

  // Scatter a few potions in corridors
  let potionsPlaced = 0;
  for (const key of corridorSet) {
    if (potionsPlaced >= 3) break;
    if (rng.chance(0.03)) {
      const [sx, sy] = key.split(",").map(Number);
      if (tiles[sy][sx] === "floor") {
        tiles[sy][sx] = "potion";
        potionsPlaced++;
      }
    }
  }

  // Place lava/water in some rooms for variety
  for (const room of rooms) {
    if (room.type === "normal" && rng.chance(0.2)) {
      placeInRoom(tiles, room, "shallow_water", rng.int(2, 4), rng, used);
    }
    if (room.type === "boss_lair" && rng.chance(0.4)) {
      placeInRoom(tiles, room, "lava", rng.int(2, 3), rng, used);
    }
  }

  // Exit tile in boss room
  const bossRoom = rooms[rooms.length - 1];
  const exitPos = roomCenter(bossRoom);
  // Shift exit to corner if center is occupied
  if (tiles[exitPos.y][exitPos.x] !== "floor") {
    exitPos.x = bossRoom.x + 1;
    exitPos.y = bossRoom.y + 1;
  }
  tiles[exitPos.y][exitPos.x] = "exit";
  used.add(`${exitPos.x},${exitPos.y}`);

  // Spawn entities
  const monsters = spawnMonsters(rooms, tiles, rng, used);
  const npcs = spawnNpcs(rooms, rng, used);
  const floorItems = spawnFloorItems(rooms, tiles, rng, used);

  return {
    seed,
    dungeonName: rng.pick(DUNGEON_NAMES),
    turn: 1,
    map: { width: W, height: H, tiles },
    monsters,
    heroes: [],
    npcs,
    floorItems,
    quests: [],
    events: [],
    pendingActions: {},
  };
}

/* ── Spawn position for new heroes ── */

export function getSpawnPosition(state: WorldState): Position {
  const { width, height, tiles } = state.map;
  // Find a floor tile with many floor neighbors (open area)
  for (let y = 1; y < height - 1; y++) {
    for (let x = 1; x < width - 1; x++) {
      if (tiles[y][x] !== "floor") continue;
      let neighbors = 0;
      for (let dy = -1; dy <= 1; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
          const t = tiles[y + dy]?.[x + dx];
          if (t && t !== "wall") neighbors++;
        }
      }
      if (neighbors >= 7) return { x, y };
    }
  }
  return { x: 2, y: 2 };
}
