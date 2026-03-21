import {
  parseBaseUrl,
  printBlock,
  spawnManagedProcess,
  waitForJson,
  waitForChildren,
  wireTermination,
  isTruthy,
} from "./demo-common.mjs";

const fallbackPort = Number.parseInt(process.env.PORT ?? "3000", 10) || 3000;
const target = parseBaseUrl(
  process.env.NEURAL_NECROPOLIS_SERVER_URL,
  fallbackPort,
);
const serverUrl = target.baseUrl;
const beatPlanningMs =
  Number.parseInt(process.env.BEAT_PLANNING_MS ?? "12000", 10) || 12000;
const scriptedCount =
  Number.parseInt(process.env.NN_DEMO_SCRIPTED_COUNT ?? "3", 10) || 3;
const dryRun = isTruthy(process.env.NN_DEMO_DRY_RUN);

const engineCommand = "npm run run:engine";
const swarmCommand = `npm run run:scripted:agents -- ${scriptedCount}`;

async function main() {
  printBlock([
    "[demo:local] starting local demo",
    `[demo:local] target server ${serverUrl}`,
    `[demo:local] engine planning window ${beatPlanningMs}ms`,
    `[demo:local] scripted bot count ${scriptedCount}`,
    `[demo:local] dashboard ${serverUrl}`,
  ]);

  if (dryRun) {
    printBlock([
      "[demo:local] dry run enabled; no processes started",
      `[demo:local] engine command: ${engineCommand}`,
      `[demo:local] swarm command: ${swarmCommand}`,
      `[demo:local] then open ${serverUrl} and switch Turns ON`,
    ]);
    return;
  }

  const children = [];
  wireTermination(children);

  spawnManagedProcess(children, "engine", engineCommand, {
    HOST: process.env.HOST ?? target.host,
    PORT: String(target.port),
    BEAT_PLANNING_MS: String(beatPlanningMs),
  });

  await waitForJson(`${serverUrl}/api/health`, "demo:local server");

  printBlock([
    `[demo:local] server is ready at ${serverUrl}`,
    `[demo:local] launching ${scriptedCount} scripted bots`,
  ]);

  spawnManagedProcess(children, "bots", swarmCommand, {
    NEURAL_NECROPOLIS_SERVER_URL: serverUrl,
  });

  printBlock([
    "",
    "[demo:local] demo is running",
    `[demo:local] next step 1: open ${serverUrl}`,
    "[demo:local] next step 2: confirm the board and bots are visible",
    "[demo:local] next step 3: switch Turns ON when you want the board to progress",
    "[demo:local] press Ctrl+C in this terminal to stop the demo",
    "",
  ]);

  await waitForChildren(children);
}

main().catch((error) => {
  const message = error instanceof Error ? error.message : String(error);
  process.stderr.write(`[demo:local] ${message}\n`);
  process.exitCode = 1;
});
