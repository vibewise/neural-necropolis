import { spawn } from "node:child_process";
import http from "node:http";
import { URL } from "node:url";
import {
  createJobRecord,
  ensureRunnerPaths,
  listJobRecords,
  listManifestRecords,
  makeJobId,
  normalizeResourceId,
  readJobLogs,
  readJobRecord,
  readManifestRecord,
  resolveRunnerPaths,
  upsertManifestRecord,
  updateJobRecord,
} from "./store.js";
import { parsePromptManifestText } from "./manifest.js";
import type {
  PromptManifest,
  PromptRunnerJob,
  PromptRunnerJobCreateRequest,
  RunnerPaths,
} from "./types.js";

class RequestError extends Error {
  readonly status: number;
  readonly code: string;

  constructor(status: number, code: string, message: string) {
    super(message);
    this.name = "RequestError";
    this.status = status;
    this.code = code;
  }
}

export type ControlPlaneServerOptions = {
  port?: number;
  host?: string;
  adminToken?: string;
  maxManifestBytes?: number;
  maxActiveJobsGlobal?: number;
  maxActiveJobsPerOwner?: number;
  dataDir?: string;
};

export async function startControlPlaneServer(
  options: ControlPlaneServerOptions = {},
): Promise<http.Server> {
  const paths = resolveRunnerPaths(options.dataDir);
  await ensureRunnerPaths(paths);

  const config = {
    host: options.host ?? process.env.PROMPT_RUNNER_HOST ?? "127.0.0.1",
    port:
      options.port ??
      Number.parseInt(process.env.PROMPT_RUNNER_PORT ?? "4010", 10),
    adminToken:
      options.adminToken ?? process.env.PROMPT_RUNNER_ADMIN_TOKEN ?? "",
    maxManifestBytes:
      options.maxManifestBytes ??
      Number.parseInt(
        process.env.PROMPT_RUNNER_MAX_MANIFEST_BYTES ?? "65536",
        10,
      ),
    maxActiveJobsGlobal:
      options.maxActiveJobsGlobal ??
      Number.parseInt(process.env.PROMPT_RUNNER_MAX_ACTIVE_JOBS ?? "8", 10),
    maxActiveJobsPerOwner:
      options.maxActiveJobsPerOwner ??
      Number.parseInt(
        process.env.PROMPT_RUNNER_MAX_ACTIVE_JOBS_PER_OWNER ?? "2",
        10,
      ),
  };

  const server = http.createServer(async (req, res) => {
    try {
      await handleRequest(req, res, config, paths);
    } catch (error) {
      if (error instanceof RequestError) {
        sendJson(res, error.status, {
          error: error.code,
          message: error.message,
        });
        return;
      }
      const message = error instanceof Error ? error.message : String(error);
      console.error(`[prompt-runner] unhandled request error: ${message}`);
      sendJson(res, 500, { error: "server_error", message });
    }
  });

  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(config.port, config.host, () => {
      server.off("error", reject);
      resolve();
    });
  });

  console.log(
    `[prompt-runner] control plane listening on http://${config.host}:${config.port} (${paths.dataDir})`,
  );
  if (!config.adminToken) {
    console.warn(
      "[prompt-runner] PROMPT_RUNNER_ADMIN_TOKEN is not set; API writes are unauthenticated.",
    );
  }
  return server;
}

async function handleRequest(
  req: http.IncomingMessage,
  res: http.ServerResponse,
  config: Required<Omit<ControlPlaneServerOptions, "dataDir">>,
  paths: RunnerPaths,
): Promise<void> {
  const method = req.method ?? "GET";
  setCorsHeaders(res);
  if (method === "OPTIONS") {
    res.writeHead(204);
    res.end();
    return;
  }
  const url = new URL(
    req.url ?? "/",
    `http://${req.headers.host ?? "localhost"}`,
  );
  const segments = url.pathname
    .split("/")
    .filter((segment) => segment.length > 0);

  if (method === "GET" && segments.length === 1 && segments[0] === "health") {
    const [manifests, jobs] = await Promise.all([
      listManifestRecords(paths),
      listJobRecords(paths),
    ]);
    sendJson(res, 200, {
      ok: true,
      manifests: manifests.length,
      jobs: jobs.length,
      activeJobs: countActiveJobs(jobs),
      dataDir: paths.dataDir,
    });
    return;
  }

  requireAdminAuth(req, config.adminToken);

  if (
    method === "GET" &&
    segments.length === 1 &&
    segments[0] === "manifests"
  ) {
    const manifests = await listManifestRecords(paths);
    sendJson(
      res,
      200,
      manifests.map((record) => ({
        id: record.id,
        ownerId: record.ownerId,
        revision: record.revision,
        createdAt: record.createdAt,
        updatedAt: record.updatedAt,
        displayName: record.manifest.agent.displayName,
      })),
    );
    return;
  }

  if (
    method === "POST" &&
    segments.length === 1 &&
    segments[0] === "manifests"
  ) {
    const body = await readJsonBody(req, config.maxManifestBytes);
    if (!isObject(body)) {
      throw badRequest("Manifest request body must be a JSON object");
    }
    const manifest = extractManifest(body);
    const manifestRecord = await upsertManifestRecord(
      paths,
      manifest,
      readOptionalString(body, "manifestId"),
      readOptionalString(body, "ownerId"),
    );
    sendJson(res, 201, manifestRecord);
    return;
  }

  if (
    method === "GET" &&
    segments.length === 2 &&
    segments[0] === "manifests"
  ) {
    const manifest = await readManifestRecord(paths, segments[1]);
    if (!manifest) {
      sendJson(res, 404, {
        error: "not_found",
        message: `Unknown manifest ${segments[1]}`,
      });
      return;
    }
    sendJson(res, 200, manifest);
    return;
  }

  if (method === "GET" && segments.length === 1 && segments[0] === "jobs") {
    const jobs = await listJobRecords(paths);
    sendJson(res, 200, jobs);
    return;
  }

  if (method === "POST" && segments.length === 1 && segments[0] === "jobs") {
    const body = await readJsonBody(req, config.maxManifestBytes);
    const request = parseJobCreateRequest(body);
    const manifestRecord = await readManifestRecord(paths, request.manifestId);
    if (!manifestRecord) {
      sendJson(res, 404, {
        error: "not_found",
        message: `Unknown manifest ${request.manifestId}`,
      });
      return;
    }

    const jobs = await listJobRecords(paths);
    enforceJobQuota(
      jobs,
      manifestRecord.ownerId,
      config.maxActiveJobsGlobal,
      config.maxActiveJobsPerOwner,
    );

    const job = buildJobRecord(
      manifestRecord.manifest,
      manifestRecord.ownerId,
      request,
    );
    await createJobRecord(paths, job);
    spawnWorker(paths, job.id);
    sendJson(res, 201, job);
    return;
  }

  if (method === "GET" && segments.length === 2 && segments[0] === "jobs") {
    const job = await readJobRecord(paths, segments[1]);
    if (!job) {
      sendJson(res, 404, {
        error: "not_found",
        message: `Unknown job ${segments[1]}`,
      });
      return;
    }
    sendJson(res, 200, job);
    return;
  }

  if (
    method === "GET" &&
    segments.length === 3 &&
    segments[0] === "jobs" &&
    segments[2] === "logs"
  ) {
    const logs = await readJobLogs(paths, segments[1]);
    sendJson(res, 200, logs);
    return;
  }

  if (
    method === "POST" &&
    segments.length === 3 &&
    segments[0] === "jobs" &&
    segments[2] === "cancel"
  ) {
    const job = await readJobRecord(paths, segments[1]);
    if (!job) {
      sendJson(res, 404, {
        error: "not_found",
        message: `Unknown job ${segments[1]}`,
      });
      return;
    }
    if (
      job.status === "completed" ||
      job.status === "failed" ||
      job.status === "cancelled"
    ) {
      sendJson(res, 409, {
        error: "invalid_state",
        message: `Job ${segments[1]} is already terminal.`,
      });
      return;
    }
    const cancelled = await updateJobRecord(paths, job.id, (current) => ({
      ...current,
      status: "cancelled",
      finishedAt: new Date().toISOString(),
    }));
    sendJson(res, 200, cancelled);
    return;
  }

  sendJson(res, 404, {
    error: "not_found",
    message: `${method} ${url.pathname} is not defined`,
  });
}

function buildJobRecord(
  manifest: PromptManifest,
  ownerId: string,
  request: PromptRunnerJobCreateRequest,
): PromptRunnerJob {
  const heroName = request.hero?.name?.trim() || manifest.agent.displayName;
  const heroId = normalizeResourceId(
    request.hero?.id?.trim() ||
      `${manifest.agent.displayName}-${Date.now().toString(36)}`,
  );
  return {
    id: makeJobId(request.manifestId),
    manifestId: request.manifestId,
    ownerId,
    status: "queued",
    createdAt: new Date().toISOString(),
    requestedBy: request.requestedBy,
    connection: request.connection ?? {},
    hero: {
      id: heroId,
      name: heroName,
      strategy: manifest.agent.strategy,
      preferredTrait: manifest.agent.preferredTrait,
    },
    attempts: 0,
    consecutiveFallbacks: 0,
  };
}

function spawnWorker(paths: RunnerPaths, jobId: string): void {
  const child = spawn(
    process.execPath,
    [...process.execArgv, process.argv[1] ?? "", "worker", "--job", jobId],
    {
      env: {
        ...process.env,
        PROMPT_RUNNER_DATA_DIR: paths.dataDir,
      },
      stdio: "ignore",
    },
  );

  void updateJobRecord(paths, jobId, (current) => ({
    ...current,
    workerPid: child.pid,
  })).catch(() => undefined);

  child.on("error", (error) => {
    void updateJobRecord(paths, jobId, (current) => ({
      ...current,
      status: "failed",
      finishedAt: new Date().toISOString(),
      failureCode: "spawn_failed",
      failureMessage: error.message,
    })).catch(() => undefined);
  });

  child.on("exit", (code, signal) => {
    void finalizeExitedChild(paths, jobId, code, signal).catch(() => undefined);
  });
}

async function finalizeExitedChild(
  paths: RunnerPaths,
  jobId: string,
  code: number | null,
  signal: NodeJS.Signals | null,
): Promise<void> {
  const job = await readJobRecord(paths, jobId);
  if (!job) {
    return;
  }
  if (
    job.status === "completed" ||
    job.status === "failed" ||
    job.status === "cancelled"
  ) {
    return;
  }
  await updateJobRecord(paths, jobId, (current) => ({
    ...current,
    status: code === 0 ? current.status : "failed",
    finishedAt: code === 0 ? current.finishedAt : new Date().toISOString(),
    failureCode: code === 0 ? current.failureCode : "worker_exit",
    failureMessage:
      code === 0
        ? current.failureMessage
        : `worker exited unexpectedly (code=${code ?? "null"}, signal=${signal ?? "none"})`,
  }));
}

function enforceJobQuota(
  jobs: PromptRunnerJob[],
  ownerId: string,
  maxActiveJobsGlobal: number,
  maxActiveJobsPerOwner: number,
): void {
  const activeJobs = jobs.filter(
    (job) => job.status === "queued" || job.status === "running",
  );
  if (activeJobs.length >= maxActiveJobsGlobal) {
    throw conflict(
      "quota_reached",
      `Global active job quota reached (${maxActiveJobsGlobal})`,
    );
  }
  const ownerJobs = activeJobs.filter((job) => job.ownerId === ownerId);
  if (ownerJobs.length >= maxActiveJobsPerOwner) {
    throw conflict(
      "quota_reached",
      `Owner ${ownerId} active job quota reached (${maxActiveJobsPerOwner})`,
    );
  }
}

function countActiveJobs(jobs: PromptRunnerJob[]): number {
  return jobs.filter(
    (job) => job.status === "queued" || job.status === "running",
  ).length;
}

function parseJobCreateRequest(body: unknown): PromptRunnerJobCreateRequest {
  if (!isObject(body)) {
    throw badRequest("Job request body must be an object");
  }
  const manifestId = readRequiredString(body, "manifestId");
  const connection = isObject(body.connection)
    ? sanitizeConnection(body.connection)
    : undefined;
  const hero = isObject(body.hero)
    ? {
        id: readOptionalString(body.hero, "id"),
        name: readOptionalString(body.hero, "name"),
      }
    : undefined;
  return {
    manifestId,
    connection,
    hero,
    requestedBy: readOptionalString(body, "requestedBy"),
  };
}

function extractManifest(body: unknown): PromptManifest {
  if (!isObject(body)) {
    throw badRequest("Manifest body must be a JSON object");
  }
  const candidate = isObject(body.manifest) ? body.manifest : body;
  try {
    return parsePromptManifestText(JSON.stringify(candidate));
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new RequestError(400, "invalid_manifest", message);
  }
}

function sanitizeConnection(value: Record<string, unknown>) {
  const headers = isObject(value.headers)
    ? Object.fromEntries(
        Object.entries(value.headers).filter(
          (entry): entry is [string, string] => typeof entry[1] === "string",
        ),
      )
    : undefined;
  return {
    baseUrl: readOptionalString(value, "baseUrl"),
    authToken: readOptionalString(value, "authToken"),
    ...(headers ? { headers } : {}),
  };
}

async function readJsonBody(
  req: http.IncomingMessage,
  maxBytes: number,
): Promise<unknown> {
  const chunks: Buffer[] = [];
  let total = 0;
  for await (const chunk of req) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    total += buffer.length;
    if (total > maxBytes) {
      throw new RequestError(
        413,
        "payload_too_large",
        `Request body exceeds ${maxBytes} bytes`,
      );
    }
    chunks.push(buffer);
  }
  const text = Buffer.concat(chunks).toString("utf8").trim();
  if (!text) {
    return {};
  }
  try {
    return JSON.parse(text) as unknown;
  } catch {
    throw new RequestError(
      400,
      "invalid_json",
      "Request body must be valid JSON",
    );
  }
}

function requireAdminAuth(req: http.IncomingMessage, adminToken: string): void {
  if (!adminToken) {
    return;
  }
  const authHeader = req.headers.authorization ?? "";
  if (authHeader !== `Bearer ${adminToken}`) {
    throw new RequestError(
      401,
      "invalid_auth",
      "Missing or invalid control-plane authorization token",
    );
  }
}

function badRequest(message: string): RequestError {
  return new RequestError(400, "invalid_request", message);
}

function conflict(code: string, message: string): RequestError {
  return new RequestError(409, code, message);
}

function sendJson(
  res: http.ServerResponse,
  status: number,
  body: unknown,
): void {
  res.writeHead(status, { "content-type": "application/json; charset=utf-8" });
  res.end(`${JSON.stringify(body, null, 2)}\n`);
}

function setCorsHeaders(res: http.ServerResponse): void {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET,POST,OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Authorization, Content-Type");
}

function isObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function readRequiredString(
  parent: Record<string, unknown>,
  key: string,
): string {
  const value = parent[key];
  if (typeof value !== "string" || value.trim().length === 0) {
    throw badRequest(`${key} must be a non-empty string`);
  }
  return value.trim();
}

function readOptionalString(
  parent: Record<string, unknown>,
  key: string,
): string | undefined {
  const value = parent[key];
  return typeof value === "string" && value.trim().length > 0
    ? value.trim()
    : undefined;
}
