import "dotenv/config";
import type { DashboardSnapshot } from "./types.js";

function resolveBaseUrl(): string {
  const port = (process.env.PORT ?? "3000").trim();
  const configured = (process.env.MMORPH_SERVER_URL ?? "").trim();
  if (!configured) return `http://127.0.0.1:${port}`;
  try {
    const parsed = new URL(configured);
    const host = parsed.hostname.toLowerCase();
    const localHost = host === "127.0.0.1" || host === "localhost";
    if (localHost && process.env.PORT) {
      parsed.port = port;
      return parsed.toString().replace(/\/$/, "");
    }
  } catch {
    return configured;
  }
  return configured;
}

const base = resolveBaseUrl();
const interval = Number(process.env.RUNNER_POLL_MS ?? 4_000);

async function poll(): Promise<void> {
  try {
    const res = await fetch(`${base}/api/dashboard`);
    if (!res.ok) {
      console.log(`[runner] server returned ${res.status}`);
      return;
    }
    const snap = (await res.json()) as DashboardSnapshot;
    const w = snap.world;
    const phase = snap.turnState;
    const leader = snap.leaderboard[0];
    console.log(
      `[runner] ${w.dungeonName} | turn ${w.turn} | ${phase.phase} | ` +
        `${snap.heroes.length} heroes | ${snap.monsters.length} monsters | ` +
        (leader
          ? `leader: ${leader.heroName} (${leader.totalScore} pts, ${leader.trait})`
          : "no heroes"),
    );
  } catch (err) {
    console.log(
      `[runner] waiting for server: ${err instanceof Error ? err.message : String(err)}`,
    );
  }
}

console.log(`[runner] polling ${base} every ${interval}ms`);
setInterval(poll, interval);
poll();
