import { config as loadEnv } from "dotenv";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { resolveRunnerPaths } from "./store.js";
import { startControlPlaneServer } from "./server.js";
import { runWorkerJob } from "./worker.js";

const moduleDir = dirname(fileURLToPath(import.meta.url));
loadEnv({ path: resolve(moduleDir, "../../../.env") });
loadEnv({ path: resolve(moduleDir, "../.env"), override: true });

async function main(): Promise<void> {
  const [command = "serve", ...args] = process.argv.slice(2);

  if (command === "serve") {
    await startControlPlaneServer();
    return;
  }

  if (command === "worker") {
    const jobId = readOption(args, "job");
    if (!jobId) {
      throw new Error("worker requires --job <jobId>");
    }
    const paths = resolveRunnerPaths();
    await runWorkerJob(paths, jobId);
    return;
  }

  throw new Error(`Unknown command ${command}`);
}

function readOption(args: string[], key: string): string | undefined {
  for (let index = 0; index < args.length; index += 1) {
    const token = args[index];
    if (token === `--${key}`) {
      return args[index + 1]?.trim();
    }
    if (token.startsWith(`--${key}=`)) {
      return token.slice(key.length + 3).trim();
    }
  }
  return undefined;
}

main().catch((error) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`[prompt-runner] ${message}`);
  process.exitCode = 1;
});
