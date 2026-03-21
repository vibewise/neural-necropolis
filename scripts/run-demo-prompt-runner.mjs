import path from "node:path";
import { readFile } from "node:fs/promises";
import {
  parseBaseUrl,
  printBlock,
  spawnManagedProcess,
  waitForJson,
  waitForChildren,
  wireTermination,
  isTruthy,
} from "./demo-common.mjs";

function parseArgs(argv) {
  return {
    auto: argv.includes("--auto"),
  };
}

async function postJson(url, body) {
  const response = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });
  if (!response.ok) {
    const text = await response.text();
    const quotaHint =
      response.status === 409 && url.endsWith("/jobs")
        ? `\n[demo:prompt-runner] inspect jobs with: Invoke-RestMethod -Uri ${promptRunnerUrl}/jobs`
        : "";
    throw new Error(
      `request to ${url} failed with ${response.status}: ${text || response.statusText}${quotaHint}`,
    );
  }
  return await response.json();
}

async function readJsonFile(filePath) {
  const content = await readFile(filePath, "utf8");
  return JSON.parse(content);
}

async function readJob(jobId) {
  const response = await fetch(`${promptRunnerUrl}/jobs/${jobId}`);
  if (!response.ok) {
    const text = await response.text();
    throw new Error(
      `request to ${promptRunnerUrl}/jobs/${jobId} failed with ${response.status}: ${text || response.statusText}`,
    );
  }
  return await response.json();
}

async function waitForJobSnapshot(jobId, timeoutMs = 5_000, intervalMs = 500) {
  const startedAt = Date.now();
  let lastJob = await readJob(jobId);
  while (Date.now() - startedAt < timeoutMs) {
    if (!["queued", "running"].includes(String(lastJob.status ?? ""))) {
      return lastJob;
    }
    await new Promise((resolve) => setTimeout(resolve, intervalMs));
    lastJob = await readJob(jobId);
  }
  return lastJob;
}

async function readHealth(url) {
  try {
    const response = await fetch(url);
    if (!response.ok) return null;
    return await response.json();
  } catch {
    return null;
  }
}

const fallbackPort = Number.parseInt(process.env.PORT ?? "3000", 10) || 3000;
const args = parseArgs(process.argv.slice(2));
const target = parseBaseUrl(
  process.env.NEURAL_NECROPOLIS_SERVER_URL,
  fallbackPort,
);
const serverUrl = target.baseUrl;
const promptRunnerHost =
  (process.env.PROMPT_RUNNER_HOST ?? "127.0.0.1").trim() || "127.0.0.1";
const promptRunnerPort =
  Number.parseInt(process.env.PROMPT_RUNNER_PORT ?? "4010", 10) || 4010;
const promptRunnerUrl = `http://${promptRunnerHost}:${promptRunnerPort}`;
const repoRoot = process.cwd();
const defaultProfilesFile = path.resolve(
  repoRoot,
  "docs",
  "PROMPT_RUNNER_PROFILES.example.json",
);
const profilesFile =
  (process.env.PROMPT_RUNNER_MODEL_PROFILES_FILE ?? "").trim() ||
  defaultProfilesFile;
const manifestFile = path.resolve(
  repoRoot,
  "docs",
  "PROMPT_MANIFEST.example.json",
);
const dryRun = isTruthy(process.env.NN_DEMO_DRY_RUN);

const engineCommand = "npm run run:engine";
const promptRunnerCommand = "npm run run:prompt-runner";

const uploadCommand = `Invoke-RestMethod -Method Post -Uri ${promptRunnerUrl}/manifests -ContentType "application/json" -InFile docs/PROMPT_MANIFEST.example.json`;
const jobCommand = [
  "$body = @'",
  "{",
  '  "manifestId": "treasure-mind",',
  '  "connection": {',
  `    "baseUrl": "${serverUrl}"`,
  "  },",
  '  "hero": {',
  '    "name": "Hosted Treasure Mind"',
  "  },",
  '  "requestedBy": "demo-operator"',
  "}",
  "'@",
  "",
  `Invoke-RestMethod -Method Post -Uri ${promptRunnerUrl}/jobs -ContentType "application/json" -Body $body`,
].join("\n");

async function main() {
  printBlock([
    "[demo:prompt-runner] starting prompt-runner demo",
    `[demo:prompt-runner] game server ${serverUrl}`,
    `[demo:prompt-runner] prompt runner ${promptRunnerUrl}`,
    `[demo:prompt-runner] model profiles file ${profilesFile}`,
    `[demo:prompt-runner] example manifest ${manifestFile}`,
    `[demo:prompt-runner] auto mode ${args.auto ? "on" : "off"}`,
  ]);

  if (dryRun) {
    printBlock([
      "[demo:prompt-runner] dry run enabled; no processes started",
      `[demo:prompt-runner] engine command: ${engineCommand}`,
      `[demo:prompt-runner] prompt runner command: ${promptRunnerCommand}`,
      "[demo:prompt-runner] upload manifest command:",
      uploadCommand,
      "[demo:prompt-runner] create job command:",
      jobCommand,
      args.auto
        ? "[demo:prompt-runner] auto mode would upload the example manifest and create the hosted job automatically"
        : "[demo:prompt-runner] auto mode is off; the commands above remain manual",
    ]);
    return;
  }

  const children = [];
  wireTermination(children);

  const existingServer = await readHealth(`${serverUrl}/api/health`);
  if (existingServer) {
    printBlock([
      `[demo:prompt-runner] reusing existing game server at ${serverUrl}`,
    ]);
  } else {
    spawnManagedProcess(children, "engine", engineCommand, {
      HOST: process.env.HOST ?? target.host,
      PORT: String(target.port),
    });
    await waitForJson(`${serverUrl}/api/health`, "demo:prompt-runner server");
  }

  const existingPromptRunner = await readHealth(`${promptRunnerUrl}/health`);
  if (existingPromptRunner) {
    printBlock([
      `[demo:prompt-runner] reusing existing prompt runner at ${promptRunnerUrl}`,
    ]);
  } else {
    spawnManagedProcess(children, "prompt-runner", promptRunnerCommand, {
      PROMPT_RUNNER_HOST: promptRunnerHost,
      PROMPT_RUNNER_PORT: String(promptRunnerPort),
      PROMPT_RUNNER_MODEL_PROFILES_FILE: profilesFile,
    });

    await waitForJson(
      `${promptRunnerUrl}/health`,
      "demo:prompt-runner control-plane",
    );
  }

  if (args.auto) {
    const manifestBody = await readJsonFile(manifestFile);
    const runId = Date.now().toString(36);
    const autoOwnerId = `demo-auto-${runId}`;
    const autoManifestId = `treasure-mind-${runId}`;
    const manifestRecord = await postJson(`${promptRunnerUrl}/manifests`, {
      manifest: manifestBody,
      manifestId: autoManifestId,
      ownerId: autoOwnerId,
    });
    const manifestId = String(
      manifestRecord.id ?? manifestRecord.manifestId ?? "",
    ).trim();
    if (!manifestId) {
      throw new Error(
        "prompt runner returned no manifest id after manifest upload",
      );
    }

    const createdJob = await postJson(`${promptRunnerUrl}/jobs`, {
      manifestId,
      connection: {
        baseUrl: serverUrl,
      },
      hero: {
        name: "Hosted Treasure Mind",
      },
      requestedBy: "demo-operator",
    });
    const jobId = String(createdJob.id ?? "").trim();
    if (!jobId) {
      throw new Error("prompt runner returned no job id after job creation");
    }

    const jobSnapshot = await waitForJobSnapshot(jobId);

    printBlock([
      "",
      "[demo:prompt-runner] auto mode completed the setup steps for you",
      `[demo:prompt-runner] uploaded manifest id: ${manifestId}`,
      `[demo:prompt-runner] uploaded owner id: ${autoOwnerId}`,
      `[demo:prompt-runner] created job id: ${jobId}`,
      `[demo:prompt-runner] current job status: ${jobSnapshot.status}`,
      `[demo:prompt-runner] open ${serverUrl}`,
      "[demo:prompt-runner] next step 1: confirm the hosted hero appears in the dashboard",
      "[demo:prompt-runner] next step 2: switch Turns ON",
      `[demo:prompt-runner] inspect this job: Invoke-RestMethod -Uri ${promptRunnerUrl}/jobs/${jobId}`,
      `[demo:prompt-runner] inspect all jobs: Invoke-RestMethod -Uri ${promptRunnerUrl}/jobs`,
      jobSnapshot.failureMessage
        ? `[demo:prompt-runner] worker message: ${jobSnapshot.failureMessage}`
        : "[demo:prompt-runner] if the selected profile uses OpenAI, set OPENAI_API_KEY before starting this demo",
      "[demo:prompt-runner] press Ctrl+C in this terminal to stop the demo",
      "",
    ]);

    await waitForChildren(children);
    return;
  }

  printBlock([
    "",
    "[demo:prompt-runner] demo services are running",
    `[demo:prompt-runner] next step 1: open ${serverUrl}`,
    "[demo:prompt-runner] next step 2: keep Turns OFF until the hosted job is created",
    "[demo:prompt-runner] next step 3: in a second PowerShell terminal, run the manifest upload command below",
    "",
    "[demo:prompt-runner] PowerShell command: upload the example manifest",
    uploadCommand,
    "",
    "[demo:prompt-runner] next step 4: in that same second terminal, run the hosted job command below",
    "",
    "[demo:prompt-runner] PowerShell command: create a hosted job",
    jobCommand,
    "",
    "[demo:prompt-runner] next step 5: inspect jobs if needed",
    `Invoke-RestMethod -Uri ${promptRunnerUrl}/jobs`,
    "",
    "[demo:prompt-runner] next step 6: go back to the dashboard and switch Turns ON",
    "[demo:prompt-runner] tip: rerun this command with -- --auto to upload the example manifest and create the hosted job automatically",
    "[demo:prompt-runner] note: if the selected profile uses OpenAI, set OPENAI_API_KEY before starting this demo",
    "[demo:prompt-runner] press Ctrl+C in this terminal to stop the demo",
    "",
  ]);

  await waitForChildren(children);
}

main().catch((error) => {
  const message = error instanceof Error ? error.message : String(error);
  process.stderr.write(`[demo:prompt-runner] ${message}\n`);
  process.exitCode = 1;
});
