import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import {
  appendJobLog,
  createJobRecord,
  ensureRunnerPaths,
  parsePromptManifestText,
  resolveRunnerPaths,
  startControlPlaneServer,
  upsertManifestRecord,
} from "../src/index.ts";
import type { PromptManifest } from "../src/index.ts";

function makeManifest(overrides: Partial<PromptManifest> = {}): PromptManifest {
  return {
    manifestVersion: "1.0",
    kind: "neural-necropolis.prompt-manifest",
    agent: {
      displayName: "Treasure Mind",
      strategy: "Prefer treasure, avoid reckless fights, escape alive.",
      preferredTrait: "curious",
    },
    prompts: {
      system: "You are a careful dungeon crawler.",
      policy: "Choose one legal action and keep the hero alive.",
      persona: "Quiet scout.",
      styleNotes: "Return concise reasoning.",
    },
    model: {
      selection: {
        mode: "profile",
        profile: "balanced-production",
      },
      temperature: 0.2,
      maxOutputTokens: 128,
      reasoningEffort: "low",
    },
    runner: {
      decisionTimeoutMs: 5000,
      maxDecisionRetries: 1,
      maxConsecutiveFallbacks: 2,
      cooldownMs: 50,
    },
    io: {
      inputMode: "observation-v1",
      outputMode: "action-index-v1",
      requireReason: true,
    },
    tools: {
      mode: "none",
      allowed: [],
    },
    fallback: {
      onTimeout: "wait",
      onMalformedOutput: "wait",
      onUnsafeOutput: "reject_turn",
    },
    metadata: {
      ownerId: "owner-a",
      createdBy: "tester",
      revision: 1,
      labels: ["test"],
      notes: "fixture",
    },
    ...overrides,
  };
}

async function withServer(options: Record<string, unknown> = {}) {
  const dataDir = await mkdtemp(join(tmpdir(), "nn-prompt-runner-"));
  const server = await startControlPlaneServer({
    host: "127.0.0.1",
    port: 0,
    dataDir,
    ...options,
  });
  const address = server.address();
  if (!address || typeof address === "string") {
    throw new Error("Expected TCP server address");
  }
  const baseUrl = `http://127.0.0.1:${address.port}`;
  const paths = resolveRunnerPaths(dataDir);
  await ensureRunnerPaths(paths);

  return {
    baseUrl,
    paths,
    async close() {
      await new Promise((resolve, reject) => {
        server.close((error) => {
          if (error) {
            reject(error);
            return;
          }
          resolve(undefined);
        });
      });
      await rm(dataDir, { recursive: true, force: true });
    },
  };
}

async function requestJson(
  baseUrl: string,
  pathname: string,
  init: RequestInit = {},
) {
  const response = await fetch(`${baseUrl}${pathname}`, init);
  const text = await response.text();
  const body = text.trim().length > 0 ? JSON.parse(text) : null;
  return { response, body };
}

function authHeaders(token = "secret") {
  return {
    Authorization: `Bearer ${token}`,
    "Content-Type": "application/json",
  };
}

test("parsePromptManifestText rejects embedded bearer tokens", () => {
  const manifest = makeManifest({
    prompts: {
      system: "Bearer abc123 should never appear here.",
      policy: "Choose one legal action.",
      persona: "Scout.",
      styleNotes: "Be terse.",
    },
  });

  assert.throws(
    () => parsePromptManifestText(JSON.stringify(manifest)),
    /must not embed bearer tokens/i,
  );
});

test("control-plane health is public and admin routes require auth", async () => {
  const harness = await withServer({ adminToken: "secret" });

  try {
    const health = await requestJson(harness.baseUrl, "/health");
    assert.equal(health.response.status, 200);
    assert.equal(health.body.ok, true);
    assert.equal(health.body.manifests, 0);

    const denied = await requestJson(harness.baseUrl, "/manifests");
    assert.equal(denied.response.status, 401);
    assert.equal(denied.body.error, "invalid_auth");

    const allowed = await requestJson(harness.baseUrl, "/manifests", {
      headers: { Authorization: "Bearer secret" },
    });
    assert.equal(allowed.response.status, 200);
    assert.deepEqual(allowed.body, []);
  } finally {
    await harness.close();
  }
});

test("manifest upload persists and listing endpoints return authoritative metadata", async () => {
  const harness = await withServer({ adminToken: "secret" });
  const manifest = makeManifest();

  try {
    const created = await requestJson(harness.baseUrl, "/manifests", {
      method: "POST",
      headers: authHeaders(),
      body: JSON.stringify({
        manifestId: "treasure-mind",
        ownerId: "owner-a",
        manifest,
      }),
    });
    assert.equal(created.response.status, 201);
    assert.equal(created.body.id, "treasure-mind");
    assert.equal(created.body.ownerId, "owner-a");
    assert.equal(created.body.revision, 1);
    assert.equal(created.body.manifest.metadata.ownerId, "owner-a");
    assert.equal(created.body.manifest.metadata.revision, 1);

    const list = await requestJson(harness.baseUrl, "/manifests", {
      headers: { Authorization: "Bearer secret" },
    });
    assert.equal(list.response.status, 200);
    assert.equal(list.body.length, 1);
    assert.equal(list.body[0].id, "treasure-mind");
    assert.equal(list.body[0].displayName, manifest.agent.displayName);

    const fetched = await requestJson(
      harness.baseUrl,
      "/manifests/treasure-mind",
      {
        headers: { Authorization: "Bearer secret" },
      },
    );
    assert.equal(fetched.response.status, 200);
    assert.equal(fetched.body.ownerId, "owner-a");
    assert.equal(fetched.body.manifest.agent.displayName, "Treasure Mind");
  } finally {
    await harness.close();
  }
});

test("job quota, logs, and cancellation routes behave predictably", async () => {
  const harness = await withServer({
    adminToken: "secret",
    maxActiveJobsGlobal: 1,
    maxActiveJobsPerOwner: 1,
  });

  try {
    const manifestRecord = await upsertManifestRecord(
      harness.paths,
      makeManifest(),
      "treasure-mind",
      "owner-a",
    );
    const job = await createJobRecord(harness.paths, {
      id: "job-queued",
      manifestId: manifestRecord.id,
      ownerId: manifestRecord.ownerId,
      status: "queued",
      createdAt: new Date().toISOString(),
      requestedBy: "tester",
      connection: { baseUrl: "http://127.0.0.1:3000" },
      hero: {
        id: "hosted-treasure-mind",
        name: "Hosted Treasure Mind",
        strategy: manifestRecord.manifest.agent.strategy,
        preferredTrait: manifestRecord.manifest.agent.preferredTrait,
      },
      attempts: 0,
      consecutiveFallbacks: 0,
    });
    await appendJobLog(harness.paths, job.id, {
      timestamp: new Date().toISOString(),
      level: "info",
      message: "queued job",
      data: { source: "test" },
    });

    const quota = await requestJson(harness.baseUrl, "/jobs", {
      method: "POST",
      headers: authHeaders(),
      body: JSON.stringify({ manifestId: manifestRecord.id }),
    });
    assert.equal(quota.response.status, 409);
    assert.equal(quota.body.error, "quota_reached");

    const logs = await requestJson(harness.baseUrl, `/jobs/${job.id}/logs`, {
      headers: { Authorization: "Bearer secret" },
    });
    assert.equal(logs.response.status, 200);
    assert.equal(logs.body.length, 1);
    assert.equal(logs.body[0].message, "queued job");

    const cancelled = await requestJson(
      harness.baseUrl,
      `/jobs/${job.id}/cancel`,
      {
        method: "POST",
        headers: { Authorization: "Bearer secret" },
      },
    );
    assert.equal(cancelled.response.status, 200);
    assert.equal(cancelled.body.status, "cancelled");

    const cancelAgain = await requestJson(
      harness.baseUrl,
      `/jobs/${job.id}/cancel`,
      {
        method: "POST",
        headers: { Authorization: "Bearer secret" },
      },
    );
    assert.equal(cancelAgain.response.status, 409);
    assert.equal(cancelAgain.body.error, "invalid_state");
  } finally {
    await harness.close();
  }
});

test("purge clears stored hosted data once no jobs are active", async () => {
  const harness = await withServer({ adminToken: "secret" });

  try {
    const manifestRecord = await upsertManifestRecord(
      harness.paths,
      makeManifest(),
      "treasure-mind",
      "owner-a",
    );
    await createJobRecord(harness.paths, {
      id: "job-complete",
      manifestId: manifestRecord.id,
      ownerId: manifestRecord.ownerId,
      status: "completed",
      createdAt: new Date().toISOString(),
      finishedAt: new Date().toISOString(),
      requestedBy: "tester",
      connection: { baseUrl: "http://127.0.0.1:3000" },
      hero: {
        id: "hosted-treasure-mind-aa11",
        name: "Hosted Treasure Mind",
        strategy: manifestRecord.manifest.agent.strategy,
        preferredTrait: manifestRecord.manifest.agent.preferredTrait,
      },
      attempts: 1,
      consecutiveFallbacks: 0,
    });

    const purged = await requestJson(harness.baseUrl, "/admin/purge", {
      method: "POST",
      headers: { Authorization: "Bearer secret" },
    });
    assert.equal(purged.response.status, 200);
    assert.equal(purged.body.ok, true);
    assert.equal(purged.body.cleared.manifests, 1);
    assert.equal(purged.body.cleared.jobs, 1);

    const manifests = await requestJson(harness.baseUrl, "/manifests", {
      headers: { Authorization: "Bearer secret" },
    });
    const jobs = await requestJson(harness.baseUrl, "/jobs", {
      headers: { Authorization: "Bearer secret" },
    });
    assert.deepEqual(manifests.body, []);
    assert.deepEqual(jobs.body, []);
  } finally {
    await harness.close();
  }
});
