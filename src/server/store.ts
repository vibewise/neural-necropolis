import { mkdir, readFile, writeFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import path from "node:path";
import type {
  BotMessage,
  Direction,
  EntityId,
  EventRecord,
  FloorItem,
  HeroAction,
  HeroProfile,
  HeroRegistration,
  HeroStats,
  HeroTrait,
  LegalAction,
  Monster,
  Npc,
  Position,
  ScoreTrack,
  StoreSnapshot,
  TileKind,
  VisionData,
  VisionTile,
  WorldState,
} from "../types.js";
import { CONFIG } from "../types.js";
import { Rng } from "../rng.js";
import { generateDungeon, getSpawnPosition } from "../world/generate.js";
import { resolveTurn } from "../world/simulate.js";

/** Typed error for hero capacity — avoids string-matching control flow. */
export class HeroCapacityError extends Error {
  readonly maxHeroes: number;
  constructor(maxHeroes: number) {
    super(`hero_capacity_reached:${maxHeroes}`);
    this.name = "HeroCapacityError";
    this.maxHeroes = maxHeroes;
  }
}

function manhattan(a: Position, b: Position): number {
  return Math.abs(a.x - b.x) + Math.abs(a.y - b.y);
}

function moveInDir(pos: Position, dir: Direction): Position {
  switch (dir) {
    case "north":
      return { x: pos.x, y: pos.y - 1 };
    case "south":
      return { x: pos.x, y: pos.y + 1 };
    case "east":
      return { x: pos.x + 1, y: pos.y };
    case "west":
      return { x: pos.x - 1, y: pos.y };
  }
}

function visionRadius(perception: number, effects: { kind: string }[]): number {
  let r = CONFIG.VISION_BASE + Math.floor(perception / 2);
  if (effects.some((e) => e.kind === "blind"))
    r = Math.max(1, Math.floor(r / 2));
  return r;
}

function isSafeSpawnTile(tile: TileKind | undefined): boolean {
  return tile === "floor";
}

export class WorldStore {
  private state!: WorldState;
  private botMessages: BotMessage[] = [];
  private rng: Rng;

  constructor(
    private readonly filePath: string,
    private readonly seed: string,
    private readonly maxHeroes = 0,
  ) {
    this.rng = new Rng(seed + ":store");
  }

  async init(): Promise<void> {
    await mkdir(path.dirname(this.filePath), { recursive: true });
    try {
      const raw = await readFile(this.filePath, "utf8");
      this.state = JSON.parse(raw) as WorldState;
    } catch {
      this.state = generateDungeon(this.seed);
      await this.persist();
    }
  }

  private buildHeroRegistrations(): HeroRegistration[] {
    return this.state.heroes.map((hero) => ({
      id: hero.id,
      name: hero.name,
      strategy: hero.strategy,
      preferredTrait: hero.trait,
    }));
  }

  async reset(
    seed: string,
    options: { preserveHeroes?: boolean } = {},
  ): Promise<void> {
    const registrations = options.preserveHeroes
      ? this.buildHeroRegistrations()
      : [];

    this.state = generateDungeon(seed);
    this.rng = new Rng(seed + ":store");
    this.botMessages = [];

    for (const registration of registrations) {
      this.registerHero(registration);
    }

    await this.persist();
  }

  async persist(): Promise<void> {
    await writeFile(this.filePath, JSON.stringify(this.state, null, 2), "utf8");
  }

  getState(): Readonly<WorldState> {
    return this.state;
  }

  /* ── Snapshot for dashboard ── */

  getSnapshot(): StoreSnapshot {
    return {
      seed: this.state.seed,
      world: {
        dungeonName: this.state.dungeonName,
        turn: this.state.turn,
        mapWidth: this.state.map.width,
        mapHeight: this.state.map.height,
      },
      heroes: this.state.heroes.map((h) => ({
        ...h,
        stats: { ...h.stats },
        position: { ...h.position },
        inventory: [...h.inventory],
        effects: [...h.effects],
      })),
      leaderboard: this.buildLeaderboard(),
      monsters: this.state.monsters.map((m) => ({
        ...m,
        position: { ...m.position },
        effects: [...m.effects],
        drops: [...m.drops],
      })),
      npcs: this.state.npcs.map((n) => ({
        ...n,
        position: { ...n.position },
        interactedBy: [...n.interactedBy],
      })),
      floorItems: this.state.floorItems.map((fi) => ({
        ...fi,
        position: { ...fi.position },
        item: { ...fi.item },
      })),
      map: this.state.map.tiles.map((row) => [...row]),
      recentEvents: this.state.events.slice(-15).reverse(),
      botMessages: [...this.botMessages],
    };
  }

  private buildLeaderboard(): ScoreTrack[] {
    return [...this.state.heroes]
      .sort((a, b) => b.score - a.score)
      .map((h) => {
        const combatScore = h.kills * 5; // simplified
        const treasureScore = h.gold;
        const explorationScore = Math.floor(
          h.tilesExplored / CONFIG.EXPLORE_SCORE_DIVISOR,
        );
        const questScore = this.state.quests
          .filter((q) => q.heroId === h.id && q.completed)
          .reduce((sum, q) => sum + q.reward.score, 0);

        return {
          heroId: h.id,
          heroName: h.name,
          trait: h.trait,
          totalScore:
            h.score +
            explorationScore +
            Math.floor(h.turnsSurvived / CONFIG.SURVIVAL_SCORE_DIVISOR),
          combatScore,
          treasureScore,
          explorationScore,
          questScore,
          turnsSurvived: h.turnsSurvived,
          tilesExplored: h.tilesExplored,
          monstersKilled: h.kills,
          escaped: h.status === "escaped",
          status: h.status,
        };
      });
  }

  /* ── Hero registration ── */

  registerHero(input: HeroRegistration): HeroProfile {
    const existing = this.state.heroes.find((h) => h.id === input.id);
    if (existing) {
      if (existing.status === "dead") {
        const spawn = getSpawnPosition(this.state);
        existing.stats = { ...CONFIG.HERO_BASE_STATS };
        existing.baseStats = { ...CONFIG.HERO_BASE_STATS };
        existing.position = spawn;
        existing.status = "alive";
        existing.inventory = [];
        existing.equipment = { weapon: null, armor: null, accessory: null };
        existing.effects = [];
        existing.fatigue = 0;
        existing.morale = CONFIG.MORALE_START;
        existing.gold = Math.floor(existing.gold / 2);
        existing.lastAction = "respawned";
      } else {
        existing.lastAction = "reconnected";
      }
      return existing;
    }

    if (this.maxHeroes > 0 && this.state.heroes.length >= this.maxHeroes) {
      throw new HeroCapacityError(this.maxHeroes);
    }

    const trait: HeroTrait = input.preferredTrait ?? "curious";
    const base: HeroStats = { ...CONFIG.HERO_BASE_STATS };
    const bonus = CONFIG.TRAIT_BONUSES[trait];
    if (bonus) {
      for (const [k, v] of Object.entries(bonus)) {
        (base as any)[k] = ((base as any)[k] ?? 0) + (v as number);
      }
      base.hp = base.maxHp;
    }

    const pos = this.pickRandomSpawnPosition();

    const hero: HeroProfile = {
      ...input,
      trait,
      stats: { ...base },
      baseStats: { ...base },
      position: pos,
      score: 0,
      kills: 0,
      tilesExplored: 0,
      gold: 0,
      inventory: [],
      equipment: { weapon: null, armor: null, accessory: null },
      effects: [],
      fatigue: 0,
      morale: CONFIG.MORALE_START,
      status: "alive",
      lastAction: "entered",
      turnsSurvived: 0,
    };

    this.state.heroes.push(hero);

    // Give rescue quest if there's a prisoner
    const prisoner = this.state.npcs.find((n) => n.kind === "prisoner");
    if (prisoner) {
      this.state.quests.push({
        id: randomUUID(),
        heroId: hero.id,
        description: `Rescue ${prisoner.name}`,
        objective: { type: "rescue", npcId: prisoner.id, done: false },
        reward: { score: 25, gold: 15 },
        completed: false,
      });
    }

    return hero;
  }

  private pickRandomSpawnPosition(): Position {
    const occupied = new Set<string>([
      ...this.state.heroes.map((h) => `${h.position.x},${h.position.y}`),
      ...this.state.monsters
        .filter((m) => m.hp > 0)
        .map((m) => `${m.position.x},${m.position.y}`),
      ...this.state.npcs.map((n) => `${n.position.x},${n.position.y}`),
    ]);

    const candidates: Position[] = [];
    for (let y = 0; y < this.state.map.height; y++) {
      for (let x = 0; x < this.state.map.width; x++) {
        const key = `${x},${y}`;
        if (occupied.has(key)) continue;
        if (!isSafeSpawnTile(this.state.map.tiles[y][x])) continue;
        candidates.push({ x, y });
      }
    }

    if (candidates.length === 0) {
      return getSpawnPosition(this.state);
    }

    const idx = this.rng.int(0, candidates.length - 1);
    return candidates[idx];
  }

  /* ── Vision + legal actions ── */

  getVision(heroId: string): VisionData {
    const hero = this.state.heroes.find((h) => h.id === heroId);
    if (!hero) throw new Error(`Unknown hero: ${heroId}`);

    const R = visionRadius(hero.stats.perception, hero.effects);
    const { width, height } = this.state.map;
    const tiles: VisionTile[] = [];

    for (
      let y = Math.max(0, hero.position.y - R);
      y <= Math.min(height - 1, hero.position.y + R);
      y++
    ) {
      for (
        let x = Math.max(0, hero.position.x - R);
        x <= Math.min(width - 1, hero.position.x + R);
        x++
      ) {
        if (
          Math.abs(x - hero.position.x) + Math.abs(y - hero.position.y) <=
          R
        ) {
          let kind = this.state.map.tiles[y][x];
          // Fog hidden traps unless high perception
          if (
            kind === "trap_hidden" &&
            hero.stats.perception < CONFIG.PERCEPTION_TRAP_THRESHOLD
          ) {
            kind = "floor";
          }
          tiles.push({ x, y, kind });
        }
      }
    }

    const visibleMonsters = this.state.monsters.filter(
      (m) => m.hp > 0 && manhattan(m.position, hero.position) <= R,
    );
    const visibleHeroes = this.state.heroes.filter(
      (h) =>
        h.id !== heroId &&
        h.status === "alive" &&
        manhattan(h.position, hero.position) <= R,
    );
    const visibleNpcs = this.state.npcs.filter(
      (n) => manhattan(n.position, hero.position) <= R,
    );
    const visibleItems = this.state.floorItems.filter(
      (fi) => manhattan(fi.position, hero.position) <= R,
    );

    return {
      seed: this.state.seed,
      turn: this.state.turn,
      hero,
      visibleTiles: tiles,
      visibleMonsters: visibleMonsters,
      visibleHeroes: visibleHeroes,
      visibleNpcs: visibleNpcs,
      visibleItems: visibleItems,
      recentEvents: this.state.events.slice(-8).reverse(),
      legalActions: this.getLegalActions(hero),
    };
  }

  private getLegalActions(hero: HeroProfile): LegalAction[] {
    if (hero.status !== "alive") return [];
    const actions: LegalAction[] = [];

    // Move in each direction
    for (const dir of ["north", "south", "east", "west"] as Direction[]) {
      const target = moveInDir(hero.position, dir);
      const tile = this.state.map.tiles[target.y]?.[target.x];
      if (!tile || tile === "wall") continue;

      if (
        tile === "door_locked" &&
        !hero.inventory.some((i) => i.kind === "key")
      )
        continue;
      if (
        tile === "chest_locked" &&
        !hero.inventory.some((i) => i.kind === "key")
      )
        continue;

      const occupiedByMonster = this.state.monsters.some(
        (m) =>
          m.hp > 0 && m.position.x === target.x && m.position.y === target.y,
      );
      if (occupiedByMonster) continue;

      let desc = `Move ${dir}`;
      if (tile === "door_closed") desc += " (opens door)";
      if (tile === "door_locked") desc += " (uses key, opens locked door)";
      if (tile === "treasure") desc += " (treasure +10!)";
      if (tile === "potion") desc += " (health potion)";
      if (tile === "exit") desc += " (ESCAPE the dungeon!)";
      if (tile === "chest") desc += " (open chest)";
      if (tile === "chest_locked") desc += " (open locked chest, uses key)";
      if (tile === "lava") desc += " (LAVA: -10 HP!)";
      if (tile === "shallow_water") desc += " (water, +fatigue)";
      if (tile === "trap_visible") desc += " (TRAP: -4 HP)";

      actions.push({ kind: "move", direction: dir, description: desc });
    }

    // Attack adjacent monsters
    for (const m of this.state.monsters) {
      if (m.hp <= 0) continue;
      if (manhattan(hero.position, m.position) <= 1) {
        actions.push({
          kind: "attack",
          targetId: m.id,
          description: `Attack ${m.name} the ${m.kind} (${m.hp}/${m.maxHp} HP, ATK ${m.attack} DEF ${m.defense})`,
        });
      }
    }

    // Use item
    for (const item of hero.inventory) {
      if (item.consumable) {
        actions.push({
          kind: "use_item",
          itemId: item.id,
          description: `Use ${item.name}: ${item.description}`,
        });
      } else if (item.slot) {
        const current = hero.equipment[item.slot];
        const desc = current
          ? `Equip ${item.name} (replace ${current.name}): ${item.description}`
          : `Equip ${item.name}: ${item.description}`;
        actions.push({ kind: "use_item", itemId: item.id, description: desc });
      }
    }

    // Interact with adjacent NPCs
    for (const npc of this.state.npcs) {
      if (manhattan(hero.position, npc.position) > 1) continue;
      if (npc.interactedBy.includes(hero.id)) continue;

      switch (npc.kind) {
        case "shrine":
          actions.push({
            kind: "interact",
            targetId: npc.id,
            description: `Pray at ${npc.name} (heal ${CONFIG.SHRINE_HEAL} HP + shield)`,
          });
          break;
        case "merchant":
          actions.push({
            kind: "interact",
            targetId: npc.id,
            description: `Trade with ${npc.name} (buy items with gold)`,
          });
          break;
        case "prisoner":
          actions.push({
            kind: "interact",
            targetId: npc.id,
            description: `Free ${npc.name} (quest reward)`,
          });
          break;
      }
    }

    // Rest + wait always available
    const restHeal = Math.min(
      CONFIG.REST_HEAL,
      hero.stats.maxHp - hero.stats.hp,
    );
    actions.push({
      kind: "rest",
      description: `Rest (heal ${restHeal} HP, reduce fatigue by ${CONFIG.FATIGUE_REST_REDUCTION})`,
    });
    actions.push({
      kind: "wait",
      description: `Wait (reduce fatigue by ${CONFIG.FATIGUE_WAIT_REDUCTION})`,
    });

    return actions;
  }

  /* ── Action submission ── */

  submitAction(
    heroId: string,
    action: HeroAction,
  ): { accepted: boolean; message: string } {
    const hero = this.state.heroes.find((h) => h.id === heroId);
    if (!hero) throw new Error(`Unknown hero: ${heroId}`);
    if (hero.status !== "alive") {
      return { accepted: false, message: `${hero.name} is ${hero.status}` };
    }
    this.state.pendingActions[hero.id] = action;
    return { accepted: true, message: `${action.kind} queued` };
  }

  /* ── Step world ── */

  stepWorld(): StoreSnapshot {
    this.state = resolveTurn(this.state);
    return this.getSnapshot();
  }

  addSystemEvent(summary: string): void {
    this.state.events = [
      ...this.state.events,
      {
        id: randomUUID(),
        turn: this.state.turn,
        type: "system" as const,
        summary,
      },
    ].slice(-CONFIG.MAX_EVENTS);
  }

  addBotMessage(heroId: string, message: string): void {
    const hero = this.state.heroes.find((h) => h.id === heroId);
    if (!hero) return;
    this.botMessages = [
      ...this.botMessages,
      {
        id: randomUUID(),
        heroId,
        heroName: hero.name,
        turn: this.state.turn,
        createdAt: Date.now(),
        message,
      },
    ].slice(-80);
  }
}
