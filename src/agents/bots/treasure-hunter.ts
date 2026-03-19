import "dotenv/config";
import { randomUUID } from "node:crypto";
import { runHeroBot } from "../sdk.js";
import type { HeroAction, LegalAction, VisionData } from "../../types.js";

const slot = process.env.BOT_SLOT?.trim();
const botName = slot ? `TreasureHunter-${slot}` : "TreasureHunter";

let planned: HeroAction | null = null;
let lastTurn = 0;
let terminalLogged = false;

await runHeroBot(
  {
    id: `treasure${slot ? `-${slot}` : ""}-${randomUUID()}`,
    name: botName,
    strategy: "grab loot, avoid danger, escape when rich",
    preferredTrait: "greedy",
  },
  async ({ api, turnState, vision, log }) => {
    const submitPlanned = async (): Promise<void> => {
      if (!planned) return;
      const action = planned;
      planned = null;
      const res = await api.act(action);
      log(res.message);
    };

    if (turnState.turn !== lastTurn) {
      planned = null;
      lastTurn = turnState.turn;
    }

    if (turnState.phase === "submit") {
      const currentVision = vision ?? (await api.observe());
      const hero = currentVision.hero;
      if (hero.status !== "alive") {
        planned = null;
        if (!terminalLogged) {
          log(hero.status === "escaped" ? "escaped with loot." : "dead.");
          terminalLogged = true;
        }
        return;
      }
      terminalLogged = false;
      const actions = currentVision.legalActions;

      // Potion at 45% HP
      if (hero.stats.hp < hero.stats.maxHp * 0.45) {
        const potion = actions.find(
          (a) =>
            a.kind === "use_item" && a.description.includes("Health Potion"),
        );
        if (potion) {
          planned = potion;
          log("drinking potion");
          await submitPlanned();
          return;
        }
      }

      // Trade with merchant
      const merchant = actions.find(
        (a) => a.kind === "interact" && a.description.includes("Trade"),
      );
      if (merchant && hero.gold >= 10) {
        planned = merchant;
        log("shopping!");
        await submitPlanned();
        return;
      }

      // Move toward loot (treasure, chest, potion, exit)
      const moves = actions.filter((a) => a.kind === "move");
      const lootMoves = moves.filter(
        (a) =>
          a.description.includes("treasure") ||
          a.description.includes("chest") ||
          a.description.includes("potion") ||
          a.description.includes("ESCAPE"),
      );
      if (lootMoves.length > 0) {
        // Prefer escape if score is high
        if (hero.score >= 60) {
          const escape = lootMoves.find((a) =>
            a.description.includes("ESCAPE"),
          );
          if (escape) {
            planned = escape;
            log("escaping with loot!");
            await submitPlanned();
            return;
          }
        }
        planned = lootMoves[0];
        log(`heading ${planned.direction} toward loot`);
        await submitPlanned();
        return;
      }

      // Move toward visible treasure/potion tiles
      const lootTiles = currentVision.visibleTiles.filter(
        (t) =>
          t.kind === "treasure" ||
          t.kind === "potion" ||
          t.kind === "chest" ||
          t.kind === "exit",
      );
      if (lootTiles.length > 0) {
        const nearest = lootTiles.sort(
          (a, b) =>
            Math.abs(a.x - hero.position.x) +
            Math.abs(a.y - hero.position.y) -
            (Math.abs(b.x - hero.position.x) + Math.abs(b.y - hero.position.y)),
        )[0];
        const dx = nearest.x - hero.position.x;
        const dy = nearest.y - hero.position.y;
        const dir =
          Math.abs(dx) >= Math.abs(dy)
            ? dx > 0
              ? "east"
              : "west"
            : dy > 0
              ? "south"
              : "north";
        const move = moves.find((a) => a.direction === dir);
        if (move) {
          planned = move;
          log(`routing ${dir} toward ${nearest.kind}`);
          await submitPlanned();
          return;
        }
      }

      // Fight only weak adjacent monsters
      const attacks = actions.filter((a) => a.kind === "attack");
      if (attacks.length > 0) {
        const weak = attacks.find((a) => {
          const hp = parseInt(a.description.match(/\((\d+)\//)?.[1] || "999");
          return hp < 12;
        });
        if (weak) {
          planned = weak;
          log("attacking weak target");
          await submitPlanned();
          return;
        }
        // Flee from strong monsters
        const monsterPositions = currentVision.visibleMonsters.map(
          (m) => m.position,
        );
        if (monsterPositions.length > 0) {
          const m = monsterPositions[0];
          const dx = m.x - hero.position.x;
          const dy = m.y - hero.position.y;
          const fleeDir =
            Math.abs(dx) >= Math.abs(dy)
              ? dx > 0
                ? "west"
                : "east"
              : dy > 0
                ? "north"
                : "south";
          const flee = moves.find((a) => a.direction === fleeDir);
          if (flee) {
            planned = flee;
            log(`fleeing ${fleeDir}`);
            await submitPlanned();
            return;
          }
        }
      }

      // Equip any equipment in inventory
      const equip = actions.find(
        (a) => a.kind === "use_item" && a.description.includes("Equip"),
      );
      if (equip) {
        planned = equip;
        log("equipping gear");
        await submitPlanned();
        return;
      }

      // Random exploration
      if (moves.length > 0) {
        planned = moves[Math.floor(Math.random() * moves.length)];
        log(`exploring ${planned.direction}`);
      } else {
        planned = { kind: "rest" };
        log("resting");
      }

      await submitPlanned();
    }
  },
);
