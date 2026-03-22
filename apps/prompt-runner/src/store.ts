import {
  appendFile,
  mkdir,
  readFile,
  readdir,
  rm,
  writeFile,
} from "node:fs/promises";
import { resolve } from "node:path";
import type {
  JobLogEntry,
  PromptManifest,
  PromptRunnerJob,
  RunnerPaths,
  StoredManifestRecord,
} from "./types.js";

export function resolveRunnerPaths(explicitDataDir?: string): RunnerPaths {
  const dataDir = resolve(
    explicitDataDir ??
      process.env.PROMPT_RUNNER_DATA_DIR ??
      "tmp/prompt-runner",
  );
  return {
    dataDir,
    manifestsDir: resolve(dataDir, "manifests"),
    jobsDir: resolve(dataDir, "jobs"),
    logsDir: resolve(dataDir, "logs"),
  };
}

export async function ensureRunnerPaths(paths: RunnerPaths): Promise<void> {
  await Promise.all([
    mkdir(paths.dataDir, { recursive: true }),
    mkdir(paths.manifestsDir, { recursive: true }),
    mkdir(paths.jobsDir, { recursive: true }),
    mkdir(paths.logsDir, { recursive: true }),
  ]);
}

export async function upsertManifestRecord(
  paths: RunnerPaths,
  manifest: PromptManifest,
  explicitId?: string,
  explicitOwnerId?: string,
): Promise<StoredManifestRecord> {
  const manifestId = normalizeResourceId(
    explicitId ?? manifest.agent.displayName,
  );
  const ownerId = explicitOwnerId ?? manifest.metadata?.ownerId ?? "anonymous";
  const filePath = manifestFilePath(paths, manifestId);
  const existing = await readJsonIfExists<StoredManifestRecord>(filePath);
  const revision = (existing?.revision ?? 0) + 1;
  const now = new Date().toISOString();
  const record: StoredManifestRecord = {
    id: manifestId,
    ownerId,
    revision,
    createdAt: existing?.createdAt ?? now,
    updatedAt: now,
    manifest: {
      ...manifest,
      metadata: {
        ...manifest.metadata,
        ownerId,
        revision,
      },
    },
  };
  await writeJson(filePath, record);
  return record;
}

export async function listManifestRecords(
  paths: RunnerPaths,
): Promise<StoredManifestRecord[]> {
  const fileNames = await safeReadDir(paths.manifestsDir);
  const records = await Promise.all(
    fileNames
      .filter((entry) => entry.endsWith(".json"))
      .map((entry) =>
        readJsonIfExists<StoredManifestRecord>(
          resolve(paths.manifestsDir, entry),
        ),
      ),
  );
  return records
    .filter((record): record is StoredManifestRecord => record != null)
    .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt));
}

export async function readManifestRecord(
  paths: RunnerPaths,
  manifestId: string,
): Promise<StoredManifestRecord | null> {
  return readJsonIfExists<StoredManifestRecord>(
    manifestFilePath(paths, manifestId),
  );
}

export async function createJobRecord(
  paths: RunnerPaths,
  job: PromptRunnerJob,
): Promise<PromptRunnerJob> {
  await writeJson(jobFilePath(paths, job.id), job);
  return job;
}

export async function readJobRecord(
  paths: RunnerPaths,
  jobId: string,
): Promise<PromptRunnerJob | null> {
  return readJsonIfExists<PromptRunnerJob>(jobFilePath(paths, jobId));
}

export async function listJobRecords(
  paths: RunnerPaths,
): Promise<PromptRunnerJob[]> {
  const fileNames = await safeReadDir(paths.jobsDir);
  const jobs = await Promise.all(
    fileNames
      .filter((entry) => entry.endsWith(".json"))
      .map((entry) =>
        readJsonIfExists<PromptRunnerJob>(resolve(paths.jobsDir, entry)),
      ),
  );
  return jobs
    .filter((job): job is PromptRunnerJob => job != null)
    .sort((left, right) => right.createdAt.localeCompare(left.createdAt));
}

export async function updateJobRecord(
  paths: RunnerPaths,
  jobId: string,
  updater: (current: PromptRunnerJob) => PromptRunnerJob,
): Promise<PromptRunnerJob> {
  const current = await readJobRecord(paths, jobId);
  if (!current) {
    throw new Error(`Unknown job ${jobId}`);
  }
  const next = updater(current);
  await writeJson(jobFilePath(paths, jobId), next);
  return next;
}

export async function appendJobLog(
  paths: RunnerPaths,
  jobId: string,
  entry: JobLogEntry,
): Promise<void> {
  await appendFile(
    logFilePath(paths, jobId),
    `${JSON.stringify(entry)}\n`,
    "utf8",
  );
}

export async function readJobLogs(
  paths: RunnerPaths,
  jobId: string,
): Promise<JobLogEntry[]> {
  const text = await readTextIfExists(logFilePath(paths, jobId));
  if (!text) {
    return [];
  }
  return text
    .split(/\r?\n/)
    .filter((line) => line.trim().length > 0)
    .map((line) => JSON.parse(line) as JobLogEntry);
}

export async function clearRunnerData(paths: RunnerPaths): Promise<void> {
  await Promise.all([
    rm(paths.manifestsDir, { recursive: true, force: true }),
    rm(paths.jobsDir, { recursive: true, force: true }),
    rm(paths.logsDir, { recursive: true, force: true }),
  ]);
  await Promise.all([
    mkdir(paths.manifestsDir, { recursive: true }),
    mkdir(paths.jobsDir, { recursive: true }),
    mkdir(paths.logsDir, { recursive: true }),
  ]);
}

export function makeJobId(manifestId: string): string {
  return `${normalizeResourceId(manifestId)}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

export function normalizeResourceId(value: string): string {
  const normalized = value
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return normalized || "resource";
}

function manifestFilePath(paths: RunnerPaths, manifestId: string): string {
  return resolve(paths.manifestsDir, `${normalizeResourceId(manifestId)}.json`);
}

function jobFilePath(paths: RunnerPaths, jobId: string): string {
  return resolve(paths.jobsDir, `${normalizeResourceId(jobId)}.json`);
}

function logFilePath(paths: RunnerPaths, jobId: string): string {
  return resolve(paths.logsDir, `${normalizeResourceId(jobId)}.jsonl`);
}

async function writeJson(filePath: string, value: unknown): Promise<void> {
  await writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

async function readJsonIfExists<T>(filePath: string): Promise<T | null> {
  const text = await readTextIfExists(filePath);
  if (text == null) {
    return null;
  }
  return JSON.parse(text) as T;
}

async function readTextIfExists(filePath: string): Promise<string | null> {
  try {
    return await readFile(filePath, "utf8");
  } catch (error) {
    if (isMissingFileError(error)) {
      return null;
    }
    throw error;
  }
}

async function safeReadDir(dirPath: string): Promise<string[]> {
  try {
    return await readdir(dirPath);
  } catch (error) {
    if (isMissingFileError(error)) {
      return [];
    }
    throw error;
  }
}

function isMissingFileError(error: unknown): error is NodeJS.ErrnoException {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    error.code === "ENOENT"
  );
}
