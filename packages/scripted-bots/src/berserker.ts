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
const botName = slot ? `Berserker-${slot}` : "Berserker";

let planned: HeroAction | null = null;
let lastTurn = 0;
let terminalLogged = false;

function pick(
  actions: LegalAction[],
  ...kinds: string[]
): LegalAction | undefined {
  return actions.find((a) => kinds.includes(a.kind));
}

function attackWeakest(actions: LegalAction[]): LegalAction | undefined {
  const attacks = actions.filter((a) => a.kind === "attack");
  if (attacks.length === 0) return undefined;
  return attacks.sort((a, b) => {
    const hpA = parseInt(a.description.match(/\((\d+)\//)?.[1] || "999");
    const hpB = parseInt(b.description.match(/\((\d+)\//)?.[1] || "999");
    return hpA - hpB;
  })[0];
}

function moveTowardMonster(
  vision: VisionData,
  actions: LegalAction[],
): LegalAction | undefined {
  if (vision.visibleMonsters.length === 0) return undefined;
  const hero = vision.hero;
  const nearest = vision.visibleMonsters.sort(
    (a, b) =>
      Math.abs(a.position.x - hero.position.x) +
      Math.abs(a.position.y - hero.position.y) -
      (Math.abs(b.position.x - hero.position.x) +
        Math.abs(b.position.y - hero.position.y)),
  )[0];
  const dx = nearest.position.x - hero.position.x;
  const dy = nearest.position.y - hero.position.y;
  const preferred =
    Math.abs(dx) >= Math.abs(dy)
      ? dx > 0
        ? "east"
        : "west"
      : dy > 0
        ? "south"
        : "north";
  return actions.find((a) => a.kind === "move" && a.direction === preferred);
}

function randomMove(actions: LegalAction[]): LegalAction | undefined {
  const moves = actions.filter((a) => a.kind === "move");
  return moves[Math.floor(Math.random() * moves.length)];
}

await runHeroBot(
  {
    id: `berserker${slot ? `-${slot}` : ""}-${randomUUID()}`,
    name: botName,
    strategy: "kill everything in sight, use potions when low",
    preferredTrait: "aggressive",
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
          log(hero.status === "escaped" ? "escaped." : "dead.");
          terminalLogged = true;
        }
        return;
      }
      terminalLogged = false;
      const actions = currentVision.legalActions;

      if (hero.stats.hp < hero.stats.maxHp * 0.35) {
        const potion = actions.find(
          (a) =>
            a.kind === "use_item" && a.description.includes("Health Potion"),
        );
        if (potion) {
          planned = potion;
          log("low HP, using potion");
          await submitPlanned();
          return;
        }
      }

      const atk = attackWeakest(actions);
      if (atk) {
        planned = atk;
        log(atk.description);
        await submitPlanned();
        return;
      }

      const charge = moveTowardMonster(currentVision, actions);
      if (charge) {
        planned = charge;
        log(`charging ${charge.direction}`);
        await submitPlanned();
        return;
      }

      const move = randomMove(actions);
      if (move) {
        planned = move;
        log(`exploring ${move.direction}`);
        await submitPlanned();
        return;
      }

      planned = pick(actions, "rest") ?? { kind: "wait" };
      log("resting");
      await submitPlanned();
    }
  },
);
