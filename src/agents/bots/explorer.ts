import "dotenv/config";
import { randomUUID } from "node:crypto";
import { runHeroBot } from "../sdk.js";
import type { HeroAction, LegalAction, VisionData } from "../../types.js";

const slot = process.env.BOT_SLOT?.trim();
const botName = slot ? `Explorer-${slot}` : "Explorer";

let planned: HeroAction | null = null;
let lastTurn = 0;
let terminalLogged = false;
const visited = new Set<string>();

function moveTarget(
  position: { x: number; y: number },
  direction: HeroAction["direction"],
): { x: number; y: number } {
  if (direction === "north") return { x: position.x, y: position.y - 1 };
  if (direction === "south") return { x: position.x, y: position.y + 1 };
  if (direction === "east") return { x: position.x + 1, y: position.y };
  if (direction === "west") return { x: position.x - 1, y: position.y };
  return position;
}

await runHeroBot(
  {
    id: `explorer${slot ? `-${slot}` : ""}-${randomUUID()}`,
    name: botName,
    strategy: "map every room, fight only when healthy, find the exit",
    preferredTrait: "curious",
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
          log(hero.status === "escaped" ? "escaped." : "fallen.");
          terminalLogged = true;
        }
        return;
      }
      terminalLogged = false;
      visited.add(`${hero.position.x},${hero.position.y}`);
      const actions = currentVision.legalActions;

      // Heal at 50% HP
      if (hero.stats.hp < hero.stats.maxHp * 0.5) {
        const potion = actions.find(
          (a) =>
            a.kind === "use_item" && a.description.includes("Health Potion"),
        );
        if (potion) {
          planned = potion;
          log("healing up");
          await submitPlanned();
          return;
        }
      }

      // Interact with shrine if available
      const shrine = actions.find(
        (a) => a.kind === "interact" && a.description.includes("shrine"),
      );
      if (shrine && hero.stats.hp < hero.stats.maxHp * 0.8) {
        planned = shrine;
        log("praying at shrine");
        await submitPlanned();
        return;
      }

      // Fight adjacent monsters if healthy enough
      if (hero.stats.hp > hero.stats.maxHp * 0.5) {
        const attacks = actions.filter((a) => a.kind === "attack");
        if (attacks.length > 0) {
          planned = attacks[0];
          log(attacks[0].description);
          await submitPlanned();
          return;
        }
      }

      // Free prisoners
      const prisoner = actions.find(
        (a) => a.kind === "interact" && a.description.includes("Free"),
      );
      if (prisoner) {
        planned = prisoner;
        log("freeing prisoner");
        await submitPlanned();
        return;
      }

      // Prefer unvisited tiles
      const moves = actions.filter((a) => a.kind === "move");
      const unvisitedMoves = moves.filter((a) => {
        if (!a.direction) return false;
        const pos = { ...hero.position };
        if (a.direction === "north") pos.y--;
        if (a.direction === "south") pos.y++;
        if (a.direction === "east") pos.x++;
        if (a.direction === "west") pos.x--;
        return !visited.has(`${pos.x},${pos.y}`);
      });

      // Prefer exit if HP is low
      if (hero.stats.hp < hero.stats.maxHp * 0.3) {
        const exitMove = moves.find((a) => a.description.includes("ESCAPE"));
        if (exitMove) {
          planned = exitMove;
          log("heading to exit (low HP)");
          await submitPlanned();
          return;
        }
      }

      if (unvisitedMoves.length > 0) {
        planned =
          unvisitedMoves[Math.floor(Math.random() * unvisitedMoves.length)];
        const target = moveTarget(hero.position, planned.direction);
        log(
          `exploring ${planned.direction} (new) (${hero.position.x},${hero.position.y})->(${target.x},${target.y})`,
        );
      } else if (moves.length > 0) {
        planned = moves[Math.floor(Math.random() * moves.length)];
        const target = moveTarget(hero.position, planned.direction);
        log(
          `backtracking ${planned.direction} (${hero.position.x},${hero.position.y})->(${target.x},${target.y})`,
        );
      } else {
        planned = { kind: "rest" };
        log("resting");
      }

      await submitPlanned();
    }
  },
);
