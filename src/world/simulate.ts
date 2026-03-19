import { randomUUID } from "node:crypto";
import { Rng } from "../rng.js";
import type {
  Direction,
  EventRecord,
  FloorItem,
  HeroAction,
  Item,
  ItemKind,
  Monster,
  MonsterKind,
  Position,
  StatusEffect,
  TileKind,
  WorldState,
} from "../types.js";
import { CONFIG } from "../types.js";
import { ITEM_TEMPLATES, MONSTER_NAMES, MONSTER_TEMPLATES } from "./data.js";

/* ── Utilities ── */

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

const WALKABLE: Set<TileKind> = new Set([
  "floor",
  "door_open",
  "treasure",
  "potion",
  "exit",
  "shallow_water",
  "lava",
  "trap_hidden",
  "trap_visible",
  "trap_triggered",
  "chest_open",
  "shrine",
  "merchant",
]);

function canWalk(tile: TileKind | undefined): boolean {
  if (!tile) return false;
  return WALKABLE.has(tile);
}

function clamp(v: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, v));
}

function evt(
  turn: number,
  type: EventRecord["type"],
  summary: string,
): EventRecord {
  return { id: randomUUID(), turn, type, summary };
}

/* ── Effective stats (with fatigue + morale + effects) ── */

function effectiveAtk(
  base: number,
  fatigue: number,
  morale: number,
  effects: StatusEffect[],
): number {
  let v = base;
  if (fatigue >= 100) v -= CONFIG.FATIGUE_PENALTY_100;
  else if (fatigue >= 75) v -= CONFIG.FATIGUE_PENALTY_75;
  else if (fatigue >= 50) v -= CONFIG.FATIGUE_PENALTY_50;
  if (morale > CONFIG.MORALE_HIGH) v += CONFIG.MORALE_HIGH_ATK;
  else if (morale < CONFIG.MORALE_LOW) v += CONFIG.MORALE_LOW_ATK;
  return Math.max(1, v);
}

function effectiveDef(
  base: number,
  fatigue: number,
  morale: number,
  effects: StatusEffect[],
): number {
  let v = base;
  if (fatigue >= 100) v -= CONFIG.FATIGUE_PENALTY_100;
  else if (fatigue >= 75) v -= CONFIG.FATIGUE_PENALTY_75;
  else if (fatigue >= 50) v -= CONFIG.FATIGUE_PENALTY_50;
  if (morale < CONFIG.MORALE_LOW) v += CONFIG.MORALE_LOW_DEF;
  const shield = effects.find((e) => e.kind === "shield");
  if (shield) v += shield.magnitude;
  return Math.max(0, v);
}

/* ── Status effects processing ── */

function processEffects(
  entity: { hp: number; effects: StatusEffect[]; name: string },
  turn: number,
  events: EventRecord[],
): void {
  for (const eff of entity.effects) {
    if (eff.kind === "poison") {
      entity.hp -= eff.magnitude;
      events.push(
        evt(
          turn,
          "effect",
          `${entity.name} takes ${eff.magnitude} poison damage.`,
        ),
      );
    } else if (eff.kind === "regen") {
      entity.hp += eff.magnitude;
      events.push(
        evt(turn, "effect", `${entity.name} regenerates ${eff.magnitude} HP.`),
      );
    }
    eff.turnsRemaining--;
  }
  entity.effects = entity.effects.filter((e) => e.turnsRemaining > 0);
}

/* ── Main turn resolution ── */

export function resolveTurn(state: WorldState): WorldState {
  const rng = new Rng(state.seed + ":" + state.turn);

  const next: WorldState = {
    ...state,
    turn: state.turn + 1,
    monsters: state.monsters.map((m) => ({
      ...m,
      position: { ...m.position },
      effects: m.effects.map((e) => ({ ...e })),
    })),
    heroes: state.heroes.map((h) => ({
      ...h,
      stats: { ...h.stats },
      baseStats: { ...h.baseStats },
      position: { ...h.position },
      inventory: [...h.inventory],
      equipment: { ...h.equipment },
      effects: h.effects.map((e) => ({ ...e })),
    })),
    npcs: state.npcs.map((n) => ({ ...n, interactedBy: [...n.interactedBy] })),
    floorItems: [...state.floorItems],
    quests: state.quests.map((q) => ({ ...q, objective: { ...q.objective } })),
    events: [...state.events],
    pendingActions: {},
  };

  const events: EventRecord[] = [];

  /* 1. Process status effects */
  for (const hero of next.heroes) {
    if (hero.status !== "alive") continue;
    const proxy = { hp: hero.stats.hp, effects: hero.effects, name: hero.name };
    processEffects(proxy, next.turn, events);
    hero.stats.hp = proxy.hp;
    hero.effects = proxy.effects;
    if (hero.stats.hp <= 0) {
      hero.status = "dead";
      hero.stats.hp = 0;
      events.push(
        evt(next.turn, "death", `${hero.name} succumbed to effects!`),
      );
    }
  }
  for (const monster of next.monsters) {
    if (monster.hp <= 0) continue;
    processEffects(monster, next.turn, events);
  }

  /* 2. Resolve hero actions (sorted by speed, highest first) */
  const aliveHeroes = next.heroes
    .filter((h) => h.status === "alive")
    .sort((a, b) => b.stats.speed - a.stats.speed);

  for (const hero of aliveHeroes) {
    const stunned = hero.effects.some((e) => e.kind === "stun");
    if (stunned) {
      hero.lastAction = "stunned";
      events.push(evt(next.turn, "effect", `${hero.name} is stunned!`));
      continue;
    }

    const action = state.pendingActions[hero.id];
    if (!action) {
      hero.lastAction = "idle";
      continue;
    }

    let didCombat = false;

    switch (action.kind) {
      case "move": {
        if (!action.direction) break;
        const target = moveInDir(hero.position, action.direction);
        const tile = next.map.tiles[target.y]?.[target.x];
        if (!tile) {
          hero.lastAction = `blocked ${action.direction}`;
          break;
        }

        // Locked door check
        if (tile === "door_locked") {
          const keyIdx = hero.inventory.findIndex((i) => i.kind === "key");
          if (keyIdx === -1) {
            hero.lastAction = "door locked (no key)";
            break;
          }
          hero.inventory.splice(keyIdx, 1);
          next.map.tiles[target.y][target.x] = "door_open";
          events.push(
            evt(next.turn, "interaction", `${hero.name} unlocked a door.`),
          );
        }

        // Closed door: open it
        if (tile === "door_closed") {
          next.map.tiles[target.y][target.x] = "door_open";
          events.push(
            evt(next.turn, "interaction", `${hero.name} opened a door.`),
          );
        }

        // Chest
        if (tile === "chest") {
          next.map.tiles[target.y][target.x] = "chest_open";
          const loot = generateChestLoot(rng);
          for (const item of loot) {
            if (hero.inventory.length < CONFIG.INVENTORY_LIMIT) {
              hero.inventory.push(item);
              events.push(
                evt(
                  next.turn,
                  "loot",
                  `${hero.name} found ${item.name} in a chest!`,
                ),
              );
            }
          }
        }

        // Locked chest
        if (tile === "chest_locked") {
          const keyIdx = hero.inventory.findIndex((i) => i.kind === "key");
          if (keyIdx === -1) {
            hero.lastAction = "chest locked (no key)";
            break;
          }
          hero.inventory.splice(keyIdx, 1);
          next.map.tiles[target.y][target.x] = "chest_open";
          const loot = generateChestLoot(rng, true);
          for (const item of loot) {
            if (hero.inventory.length < CONFIG.INVENTORY_LIMIT) {
              hero.inventory.push(item);
              events.push(
                evt(
                  next.turn,
                  "loot",
                  `${hero.name} found ${item.name} in a locked chest!`,
                ),
              );
            }
          }
        }

        const resolvedTile = next.map.tiles[target.y][target.x];

        // Check walkability after door/chest resolution
        if (
          resolvedTile === "wall" ||
          resolvedTile === "door_locked" ||
          resolvedTile === "chest_locked"
        ) {
          hero.lastAction = `blocked ${action.direction}`;
          break;
        }

        // Monster collision
        const blockedByMonster = next.monsters.some(
          (m) =>
            m.hp > 0 && m.position.x === target.x && m.position.y === target.y,
        );
        if (blockedByMonster) {
          hero.lastAction = `blocked by monster ${action.direction}`;
          break;
        }

        // Move
        hero.position = target;
        hero.lastAction = `moved ${action.direction}`;

        // Tile effects
        const landedTile = next.map.tiles[target.y][target.x];

        if (landedTile === "treasure") {
          hero.score += CONFIG.TREASURE_SCORE;
          hero.morale = clamp(
            hero.morale + CONFIG.MORALE_TREASURE,
            CONFIG.MORALE_MIN,
            CONFIG.MORALE_MAX,
          );
          next.map.tiles[target.y][target.x] = "floor";
          events.push(
            evt(
              next.turn,
              "loot",
              `${hero.name} found treasure! +${CONFIG.TREASURE_SCORE}`,
            ),
          );
        } else if (landedTile === "potion") {
          if (hero.inventory.length < CONFIG.INVENTORY_LIMIT) {
            hero.inventory.push({
              id: randomUUID(),
              ...ITEM_TEMPLATES.health_potion,
            });
            events.push(
              evt(next.turn, "loot", `${hero.name} picked up a health potion.`),
            );
          }
          next.map.tiles[target.y][target.x] = "floor";
        } else if (landedTile === "exit") {
          hero.status = "escaped";
          hero.score += CONFIG.ESCAPE_BONUS;
          events.push(
            evt(
              next.turn,
              "movement",
              `${hero.name} escaped the dungeon! +${CONFIG.ESCAPE_BONUS}`,
            ),
          );
        } else if (landedTile === "trap_hidden") {
          hero.stats.hp -= CONFIG.TRAP_DAMAGE;
          next.map.tiles[target.y][target.x] = "trap_triggered";
          events.push(
            evt(
              next.turn,
              "trap",
              `${hero.name} triggered a hidden trap! -${CONFIG.TRAP_DAMAGE} HP`,
            ),
          );
          if (hero.stats.hp <= 0) {
            hero.status = "dead";
            hero.stats.hp = 0;
            events.push(
              evt(next.turn, "death", `${hero.name} was killed by a trap!`),
            );
          }
        } else if (landedTile === "trap_visible") {
          hero.stats.hp -= CONFIG.TRAP_VISIBLE_DAMAGE;
          next.map.tiles[target.y][target.x] = "trap_triggered";
          events.push(
            evt(
              next.turn,
              "trap",
              `${hero.name} walked through a visible trap! -${CONFIG.TRAP_VISIBLE_DAMAGE} HP`,
            ),
          );
          if (hero.stats.hp <= 0) {
            hero.status = "dead";
            hero.stats.hp = 0;
            events.push(
              evt(next.turn, "death", `${hero.name} was killed by a trap!`),
            );
          }
        } else if (landedTile === "lava") {
          hero.stats.hp -= CONFIG.LAVA_DAMAGE;
          events.push(
            evt(
              next.turn,
              "trap",
              `${hero.name} is standing in lava! -${CONFIG.LAVA_DAMAGE} HP`,
            ),
          );
          if (hero.stats.hp <= 0) {
            hero.status = "dead";
            hero.stats.hp = 0;
            events.push(
              evt(next.turn, "death", `${hero.name} was consumed by lava!`),
            );
          }
        } else if (landedTile === "shallow_water") {
          hero.fatigue = clamp(
            hero.fatigue + CONFIG.FATIGUE_WATER_EXTRA,
            0,
            CONFIG.FATIGUE_MAX,
          );
        }

        // Pick up floor items at new position
        const itemsHere = next.floorItems.filter(
          (fi) => fi.position.x === target.x && fi.position.y === target.y,
        );
        for (const fi of itemsHere) {
          if (hero.inventory.length < CONFIG.INVENTORY_LIMIT) {
            hero.inventory.push(fi.item);
            events.push(
              evt(next.turn, "loot", `${hero.name} picked up ${fi.item.name}.`),
            );
          }
          // Auto-equip if slot is empty
          if (fi.item.slot && !hero.equipment[fi.item.slot]) {
            equipItem(hero, fi.item);
          }
        }
        next.floorItems = next.floorItems.filter(
          (fi) => !(fi.position.x === target.x && fi.position.y === target.y),
        );

        hero.tilesExplored++;
        break;
      }

      case "attack": {
        const monster = next.monsters.find(
          (m) => m.id === action.targetId && m.hp > 0,
        );
        if (!monster || manhattan(hero.position, monster.position) > 1) {
          hero.lastAction = "attack missed (no target)";
          break;
        }

        const atk = effectiveAtk(
          hero.stats.attack,
          hero.fatigue,
          hero.morale,
          hero.effects,
        );
        const def = effectiveDef(monster.defense, 0, 50, monster.effects);
        const dmg = Math.max(1, atk - def + rng.int(0, 2));
        monster.hp -= dmg;
        hero.lastAction = `hit ${monster.name} for ${dmg}`;
        didCombat = true;
        events.push(
          evt(
            next.turn,
            "combat",
            `${hero.name} hit ${monster.name} for ${dmg} dmg.`,
          ),
        );

        if (monster.hp <= 0) {
          hero.score += monster.xpReward;
          hero.gold += monster.goldDrop;
          hero.kills++;
          hero.morale = clamp(
            hero.morale + CONFIG.MORALE_KILL,
            CONFIG.MORALE_MIN,
            CONFIG.MORALE_MAX,
          );
          events.push(
            evt(
              next.turn,
              "death",
              `${hero.name} slew ${monster.name}! +${monster.xpReward} XP, +${monster.goldDrop} gold`,
            ),
          );

          // Drop items
          for (const dropKind of monster.drops) {
            if (rng.chance(0.5)) {
              const tmpl = ITEM_TEMPLATES[dropKind];
              next.floorItems.push({
                id: randomUUID(),
                item: { id: randomUUID(), ...tmpl },
                position: { ...monster.position },
              });
              events.push(
                evt(next.turn, "loot", `${monster.name} dropped ${tmpl.name}.`),
              );
            }
          }

          // Quest progress
          for (const q of next.quests) {
            if (
              q.heroId === hero.id &&
              !q.completed &&
              q.objective.type === "kill"
            ) {
              if (q.objective.monsterKind === monster.kind) {
                q.objective.progress++;
                if (q.objective.progress >= q.objective.count) {
                  q.completed = true;
                  hero.score += q.reward.score;
                  hero.gold += q.reward.gold;
                  events.push(
                    evt(
                      next.turn,
                      "quest",
                      `${hero.name} completed quest: ${q.description}! +${q.reward.score} pts`,
                    ),
                  );
                }
              }
            }
          }
        }
        break;
      }

      case "rest": {
        const heal = Math.min(
          CONFIG.REST_HEAL,
          hero.stats.maxHp - hero.stats.hp,
        );
        hero.stats.hp += heal;
        hero.fatigue = clamp(
          hero.fatigue - CONFIG.FATIGUE_REST_REDUCTION,
          0,
          CONFIG.FATIGUE_MAX,
        );
        hero.lastAction = `rested +${heal} HP`;
        break;
      }

      case "use_item": {
        const itemIdx = hero.inventory.findIndex((i) => i.id === action.itemId);
        if (itemIdx === -1) {
          hero.lastAction = "no such item";
          break;
        }
        const item = hero.inventory[itemIdx];

        if (item.consumable) {
          hero.inventory.splice(itemIdx, 1);
          switch (item.kind) {
            case "health_potion": {
              const heal = Math.min(
                CONFIG.POTION_HEAL,
                hero.stats.maxHp - hero.stats.hp,
              );
              hero.stats.hp += heal;
              hero.lastAction = `potion +${heal} HP`;
              events.push(
                evt(
                  next.turn,
                  "loot",
                  `${hero.name} used a potion, healed ${heal} HP.`,
                ),
              );
              break;
            }
            case "antidote": {
              hero.effects = hero.effects.filter((e) => e.kind !== "poison");
              hero.lastAction = "antidote - cured poison";
              events.push(
                evt(next.turn, "effect", `${hero.name} cured poison.`),
              );
              break;
            }
            case "key": {
              hero.lastAction = "used key (nothing to unlock here)";
              // Keys are consumed by doors/chests during move; standalone use does nothing useful
              break;
            }
            case "scroll_reveal": {
              const R = CONFIG.SCROLL_REVEAL_RADIUS;
              let revealed = 0;
              for (let dy = -R; dy <= R; dy++) {
                for (let dx = -R; dx <= R; dx++) {
                  const ty = hero.position.y + dy;
                  const tx = hero.position.x + dx;
                  if (next.map.tiles[ty]?.[tx] === "trap_hidden") {
                    next.map.tiles[ty][tx] = "trap_visible";
                    revealed++;
                  }
                }
              }
              hero.lastAction = `scroll of reveal (${revealed} traps found)`;
              events.push(
                evt(
                  next.turn,
                  "interaction",
                  `${hero.name} used Scroll of Reveal — ${revealed} traps revealed!`,
                ),
              );
              break;
            }
            case "scroll_teleport": {
              const { width, height, tiles } = next.map;
              for (let a = 0; a < 200; a++) {
                const tx = rng.int(1, width - 2);
                const ty = rng.int(1, height - 2);
                if (tiles[ty][tx] === "floor") {
                  const occupied = next.monsters.some(
                    (m) =>
                      m.hp > 0 && m.position.x === tx && m.position.y === ty,
                  );
                  if (!occupied) {
                    hero.position = { x: tx, y: ty };
                    hero.lastAction = "teleported!";
                    events.push(
                      evt(
                        next.turn,
                        "movement",
                        `${hero.name} teleported away!`,
                      ),
                    );
                    break;
                  }
                }
              }
              break;
            }
          }
        } else if (item.slot) {
          // Equip
          hero.inventory.splice(itemIdx, 1);
          equipItem(hero, item);
          hero.lastAction = `equipped ${item.name}`;
          events.push(
            evt(next.turn, "loot", `${hero.name} equipped ${item.name}.`),
          );
        }
        break;
      }

      case "interact": {
        const npc = next.npcs.find((n) => n.id === action.targetId);
        if (!npc || manhattan(hero.position, npc.position) > 1) {
          hero.lastAction = "nothing to interact with";
          break;
        }

        if (npc.interactedBy.includes(hero.id)) {
          hero.lastAction = `already interacted with ${npc.name}`;
          break;
        }

        npc.interactedBy.push(hero.id);

        switch (npc.kind) {
          case "shrine": {
            const heal = Math.min(
              CONFIG.SHRINE_HEAL,
              hero.stats.maxHp - hero.stats.hp,
            );
            hero.stats.hp += heal;
            hero.effects.push({
              kind: "shield",
              turnsRemaining: 3,
              magnitude: 3,
            });
            hero.morale = clamp(
              hero.morale + CONFIG.MORALE_SHRINE,
              CONFIG.MORALE_MIN,
              CONFIG.MORALE_MAX,
            );
            hero.lastAction = `shrine: +${heal} HP, +shield`;
            events.push(
              evt(
                next.turn,
                "interaction",
                `${hero.name} prayed at ${npc.name} — healed ${heal} HP, gained shield.`,
              ),
            );
            break;
          }
          case "merchant": {
            // Buy the most expensive item the hero can afford
            if (npc.inventory && npc.inventory.length > 0) {
              const affordable = npc.inventory
                .filter((i) => i.value <= hero.gold)
                .sort((a, b) => b.value - a.value);
              if (
                affordable.length > 0 &&
                hero.inventory.length < CONFIG.INVENTORY_LIMIT
              ) {
                const bought = affordable[0];
                hero.gold -= bought.value;
                hero.inventory.push(bought);
                npc.inventory = npc.inventory.filter((i) => i.id !== bought.id);
                hero.lastAction = `bought ${bought.name} for ${bought.value}g`;
                events.push(
                  evt(
                    next.turn,
                    "interaction",
                    `${hero.name} bought ${bought.name} from ${npc.name}.`,
                  ),
                );
              } else {
                hero.lastAction = "merchant: nothing affordable";
              }
            }
            break;
          }
          case "prisoner": {
            hero.lastAction = `freed ${npc.name}`;
            events.push(
              evt(next.turn, "interaction", `${hero.name} freed ${npc.name}!`),
            );

            // Grant rescue quest completion or create one
            let questCompleted = false;
            for (const q of next.quests) {
              if (
                q.heroId === hero.id &&
                !q.completed &&
                q.objective.type === "rescue" &&
                q.objective.npcId === npc.id
              ) {
                q.objective.done = true;
                q.completed = true;
                hero.score += q.reward.score;
                hero.gold += q.reward.gold;
                questCompleted = true;
                events.push(
                  evt(
                    next.turn,
                    "quest",
                    `${hero.name} completed rescue quest! +${q.reward.score} pts`,
                  ),
                );
              }
            }
            if (!questCompleted) {
              hero.score += 15;
              hero.gold += 10;
              events.push(
                evt(
                  next.turn,
                  "quest",
                  `${hero.name} earned a rescue bonus: +15 pts, +10 gold.`,
                ),
              );
            }
            break;
          }
        }
        break;
      }

      case "wait": {
        hero.fatigue = clamp(
          hero.fatigue - CONFIG.FATIGUE_WAIT_REDUCTION,
          0,
          CONFIG.FATIGUE_MAX,
        );
        hero.lastAction = "waited";
        break;
      }
    }

    // Fatigue update
    if (hero.status === "alive") {
      hero.fatigue = clamp(
        hero.fatigue +
          CONFIG.FATIGUE_PER_TURN +
          (didCombat ? CONFIG.FATIGUE_COMBAT_EXTRA : 0),
        0,
        CONFIG.FATIGUE_MAX,
      );
      hero.turnsSurvived++;
    }
  }

  /* 3. Monster AI */
  for (const monster of next.monsters) {
    if (monster.hp <= 0) continue;

    const alive = next.heroes.filter((h) => h.status === "alive");
    if (alive.length === 0) break;

    const nearest = alive.reduce((best, h) =>
      manhattan(monster.position, h.position) <
      manhattan(monster.position, best.position)
        ? h
        : best,
    );
    const dist = manhattan(monster.position, nearest.position);

    // Flee behavior override
    if (monster.hp < monster.maxHp * 0.25 && monster.behavior !== "guard") {
      // Run away
      if (dist <= 1) {
        // Attack even when fleeing if cornered
        attackHero(monster, nearest, next.turn, events, rng);
      } else {
        moveAway(monster, nearest.position, next);
      }
      continue;
    }

    switch (monster.behavior) {
      case "chase": {
        if (dist <= 1) {
          attackHero(monster, nearest, next.turn, events, rng);
        } else if (dist <= monster.alertRange) {
          moveToward(monster, nearest.position, next);
        }
        break;
      }
      case "patrol": {
        if (dist <= 1) {
          attackHero(monster, nearest, next.turn, events, rng);
        } else if (dist <= monster.alertRange) {
          moveToward(monster, nearest.position, next);
        } else if (rng.chance(0.3)) {
          randomStep(monster, next, rng);
        }
        break;
      }
      case "ambush": {
        if (dist <= 1) {
          attackHero(monster, nearest, next.turn, events, rng);
        } else if (dist <= 2) {
          moveToward(monster, nearest.position, next);
        }
        // Otherwise sit still
        break;
      }
      case "guard": {
        if (dist <= 1) {
          attackHero(monster, nearest, next.turn, events, rng);
        } else if (dist <= monster.alertRange) {
          moveToward(monster, nearest.position, next);
        }
        break;
      }
      case "flee": {
        if (dist <= 1) {
          attackHero(monster, nearest, next.turn, events, rng);
        } else {
          moveAway(monster, nearest.position, next);
        }
        break;
      }
    }
  }

  /* 4. Lava damage for heroes standing on lava */
  for (const hero of next.heroes) {
    if (hero.status !== "alive") continue;
    if (next.map.tiles[hero.position.y]?.[hero.position.x] === "lava") {
      // Already handled in move; this covers heroes who stayed on lava
    }
  }

  /* 5. Remove dead monsters */
  next.monsters = next.monsters.filter((m) => m.hp > 0);

  /* 6. Spawn new monsters if running low */
  if (
    next.monsters.length < CONFIG.MONSTER_SPAWN_MIN &&
    rng.chance(CONFIG.MONSTER_SPAWN_CHANCE)
  ) {
    const { width, height, tiles } = next.map;
    for (let attempt = 0; attempt < 80; attempt++) {
      const x = rng.int(1, width - 2);
      const y = rng.int(1, height - 2);
      if (tiles[y][x] !== "floor") continue;
      const farEnough = next.heroes.every(
        (h) => h.status !== "alive" || manhattan(h.position, { x, y }) > 8,
      );
      if (!farEnough) continue;

      const kind: MonsterKind = rng.pick([
        "goblin",
        "goblin",
        "spider",
        "skeleton",
      ] as MonsterKind[]);
      const tmpl = MONSTER_TEMPLATES[kind];
      next.monsters.push({
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
        position: { x, y },
        effects: [],
        drops: [...tmpl.drops],
        alertRange: tmpl.alertRange,
      });
      events.push(evt(next.turn, "spawn", `A ${kind} lurks in the shadows!`));
      break;
    }
  }

  /* 7. Notify ally deaths for morale */
  const deaths = events.filter(
    (e) => e.type === "death" && e.summary.includes("was slain"),
  );
  if (deaths.length > 0) {
    for (const hero of next.heroes) {
      if (hero.status === "alive") {
        hero.morale = clamp(
          hero.morale + CONFIG.MORALE_ALLY_DEATH,
          CONFIG.MORALE_MIN,
          CONFIG.MORALE_MAX,
        );
      }
    }
  }

  next.events = [...next.events, ...events].slice(-CONFIG.MAX_EVENTS);
  return next;
}

/* ── Monster combat helpers ── */

function attackHero(
  monster: Monster,
  hero: {
    stats: { hp: number; defense: number };
    status: string;
    name: string;
    morale: number;
    fatigue: number;
    effects: StatusEffect[];
  },
  turn: number,
  events: EventRecord[],
  rng: Rng,
): void {
  const def = effectiveDef(
    hero.stats.defense,
    (hero as any).fatigue ?? 0,
    (hero as any).morale ?? 50,
    hero.effects,
  );
  const dmg = Math.max(1, monster.attack - def + rng.int(0, 1));
  hero.stats.hp -= dmg;
  (hero as any).morale = clamp(
    ((hero as any).morale ?? 50) + CONFIG.MORALE_DAMAGE,
    CONFIG.MORALE_MIN,
    CONFIG.MORALE_MAX,
  );
  events.push(
    evt(turn, "combat", `${monster.name} hit ${hero.name} for ${dmg}!`),
  );

  // Spider poison
  if (monster.kind === "spider" && rng.chance(0.4)) {
    hero.effects.push({ kind: "poison", turnsRemaining: 3, magnitude: 3 });
    (hero as any).morale = clamp(
      ((hero as any).morale ?? 50) + CONFIG.MORALE_POISON,
      CONFIG.MORALE_MIN,
      CONFIG.MORALE_MAX,
    );
    events.push(
      evt(turn, "effect", `${hero.name} was poisoned by ${monster.name}!`),
    );
  }

  // Wraith blind
  if (monster.kind === "wraith" && rng.chance(0.3)) {
    hero.effects.push({ kind: "blind", turnsRemaining: 2, magnitude: 0 });
    events.push(
      evt(turn, "effect", `${hero.name} was blinded by ${monster.name}!`),
    );
  }

  if (hero.stats.hp <= 0) {
    (hero as any).status = "dead";
    hero.stats.hp = 0;
    events.push(
      evt(turn, "death", `${hero.name} was slain by ${monster.name}!`),
    );
  }
}

function moveToward(
  monster: Monster,
  target: Position,
  state: WorldState,
): void {
  const dx = target.x - monster.position.x;
  const dy = target.y - monster.position.y;
  const candidates: Position[] =
    Math.abs(dx) >= Math.abs(dy)
      ? [
          { x: monster.position.x + Math.sign(dx), y: monster.position.y },
          { x: monster.position.x, y: monster.position.y + Math.sign(dy || 1) },
        ]
      : [
          { x: monster.position.x, y: monster.position.y + Math.sign(dy) },
          { x: monster.position.x + Math.sign(dx || 1), y: monster.position.y },
        ];

  for (const c of candidates) {
    if (canMonsterWalk(c, state)) {
      monster.position = c;
      return;
    }
  }
}

function moveAway(monster: Monster, target: Position, state: WorldState): void {
  const dx = monster.position.x - target.x;
  const dy = monster.position.y - target.y;
  const candidates: Position[] = [
    { x: monster.position.x + Math.sign(dx || 1), y: monster.position.y },
    { x: monster.position.x, y: monster.position.y + Math.sign(dy || 1) },
    { x: monster.position.x - Math.sign(dx || 1), y: monster.position.y },
    { x: monster.position.x, y: monster.position.y - Math.sign(dy || 1) },
  ];

  for (const c of candidates) {
    if (canMonsterWalk(c, state)) {
      monster.position = c;
      return;
    }
  }
}

function randomStep(monster: Monster, state: WorldState, rng: Rng): void {
  const dirs: Direction[] = ["north", "south", "east", "west"];
  const shuffled = rng.shuffle(dirs);
  for (const d of shuffled) {
    const c = moveInDir(monster.position, d);
    if (canMonsterWalk(c, state)) {
      monster.position = c;
      return;
    }
  }
}

function canMonsterWalk(pos: Position, state: WorldState): boolean {
  const tile = state.map.tiles[pos.y]?.[pos.x];
  if (!tile) return false;
  const ok: Set<TileKind> = new Set([
    "floor",
    "door_open",
    "trap_hidden",
    "trap_triggered",
    "shallow_water",
  ]);
  if (!ok.has(tile)) return false;
  const blockedByHero = state.heroes.some(
    (h) =>
      h.status === "alive" && h.position.x === pos.x && h.position.y === pos.y,
  );
  const blockedByMonster = state.monsters.some(
    (m) =>
      m.hp > 0 &&
      m.position.x === pos.x &&
      m.position.y === pos.y &&
      m !== state.monsters.find((x) => x.position === pos),
  );
  return !blockedByHero && !blockedByMonster;
}

/* ── Equipment helper ── */

function equipItem(
  hero: {
    equipment: { weapon: any; armor: any; accessory: any };
    inventory: any[];
    stats: any;
    baseStats: any;
  },
  item: any,
): void {
  const slot = item.slot as "weapon" | "armor" | "accessory";
  const old = hero.equipment[slot];
  if (old) {
    hero.inventory.push(old);
    removeStatBonus(hero, old);
  }
  hero.equipment[slot] = item;
  applyStatBonus(hero, item);
}

function applyStatBonus(hero: any, item: any): void {
  if (!item.statBonus) return;
  for (const [k, v] of Object.entries(item.statBonus)) {
    hero.stats[k] = (hero.stats[k] ?? 0) + (v as number);
    if (k === "maxHp")
      hero.stats.hp = Math.min(hero.stats.hp, hero.stats.maxHp);
  }
}

function removeStatBonus(hero: any, item: any): void {
  if (!item.statBonus) return;
  for (const [k, v] of Object.entries(item.statBonus)) {
    hero.stats[k] = (hero.stats[k] ?? 0) - (v as number);
    if (k === "maxHp")
      hero.stats.hp = Math.min(hero.stats.hp, hero.stats.maxHp);
  }
}

/* ── Chest loot generation ── */

function generateChestLoot(rng: Rng, rare = false): Item[] {
  const pool = rare
    ? ([
        "health_potion",
        "key",
        "scroll_reveal",
        "sword",
        "chain_armor",
        "amulet_protection",
      ] as const)
    : (["health_potion", "key", "antidote"] as const);
  const count = rng.int(1, rare ? 2 : 1);
  const items: Item[] = [];
  for (let i = 0; i < count; i++) {
    const kind = rng.pick(pool);
    items.push({ id: randomUUID(), ...ITEM_TEMPLATES[kind] });
  }
  return items;
}
