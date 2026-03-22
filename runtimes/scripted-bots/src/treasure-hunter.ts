import { config as loadEnv } from "dotenv";
import { randomUUID } from "node:crypto";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { runHeroBot } from "@neural-necropolis/agent-sdk";
import type {
  HeroAction,
  LegalAction,
  VisionData,
} from "@neural-necropolis/protocol-ts";

const moduleDir = dirname(fileURLToPath(import.meta.url));
loadEnv({ path: resolve(moduleDir, "../../../.env") });
loadEnv({ path: resolve(moduleDir, "../.env"), override: true });

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

      const merchant = actions.find(
        (a) => a.kind === "interact" && a.description.includes("Trade"),
      );
      if (merchant && hero.gold >= 10) {
        planned = merchant;
        log("shopping!");
        await submitPlanned();
        return;
      }

      const moves = actions.filter((a) => a.kind === "move");
      const lootMoves = moves.filter(
        (a) =>
          a.description.includes("treasure") ||
          a.description.includes("chest") ||
          a.description.includes("potion") ||
          a.description.includes("ESCAPE"),
      );
      if (lootMoves.length > 0) {
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
        const monsterPositions = currentVision.visibleMonsters.map(
          (m) => m.position,
        );
        if (monsterPositions.length > 0) {
          const monster = monsterPositions[0];
          const dx = monster.x - hero.position.x;
          const dy = monster.y - hero.position.y;
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

      const equip = actions.find(
        (a) => a.kind === "use_item" && a.description.includes("Equip"),
      );
      if (equip) {
        planned = equip;
        log("equipping gear");
        await submitPlanned();
        return;
      }

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
