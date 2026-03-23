import type {
  BoardSnapshot,
  CompletedBoardsResponse,
  DashboardResponse,
  GameSettings,
  HealthResponse,
  LeaderboardResponse,
  ManagerSnapshot,
  SeedResponse,
  ArenaListResponse,
  ArenaSnapshot,
  ArenaMatchSnapshot,
  DuelResult,
  CreateArenaRequest,
  AddMatchRequest,
} from "@neural-necropolis/protocol-ts";
import type {
  JobLogEntry,
  PromptManifest,
  PromptRunnerJob,
  StoredManifestRecord,
} from "@neural-necropolis/prompt-runner/types";

export type {
  BoardSnapshot,
  CompletedBoardsResponse,
  DashboardResponse,
  GameSettings,
  HealthResponse,
  LeaderboardResponse,
  ManagerSnapshot,
  SeedResponse,
  ArenaListResponse,
  ArenaSnapshot,
  ArenaMatchSnapshot,
  ArenaBotConfig,
  ArenaBotStanding,
  ArenaSummary,
  DuelResult,
  CreateArenaRequest,
  AddMatchRequest,
} from "@neural-necropolis/protocol-ts";
export type {
  JobLogEntry,
  PromptManifest,
  PromptRunnerJob,
  StoredManifestRecord,
} from "@neural-necropolis/prompt-runner/types";

async function fetchJson<T>(url: string): Promise<T> {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`${url} failed with ${response.status}`);
  }
  return (await response.json()) as T;
}

export function fetchHealth(apiBase: string): Promise<HealthResponse> {
  return fetchJson<HealthResponse>(`${apiBase}/api/health`);
}

export function fetchDashboard(
  apiBase: string,
  boardId?: string | null,
): Promise<DashboardResponse> {
  const query = boardId ? `?boardId=${encodeURIComponent(boardId)}` : "";
  return fetchJson<DashboardResponse>(`${apiBase}/api/dashboard${query}`);
}

export function fetchBoards(apiBase: string): Promise<ManagerSnapshot> {
  return fetchJson<ManagerSnapshot>(`${apiBase}/api/boards`);
}

export function fetchCompletedBoards(
  apiBase: string,
  offset = 0,
  limit = 6,
): Promise<CompletedBoardsResponse> {
  const query = new URLSearchParams({
    offset: String(offset),
    limit: String(limit),
  });
  return fetchJson<CompletedBoardsResponse>(
    `${apiBase}/api/boards/completed?${query.toString()}`,
  );
}

export function fetchLeaderboard(
  apiBase: string,
): Promise<LeaderboardResponse> {
  return fetchJson<LeaderboardResponse>(`${apiBase}/api/leaderboard`);
}

export function fetchSeed(apiBase: string): Promise<SeedResponse> {
  return fetchJson<SeedResponse>(`${apiBase}/api/seed`);
}

export function createStreamUrl(apiBase: string): string {
  return `${apiBase}/api/stream`;
}

export type AdminSnapshotResponse = {
  ok: boolean;
  alreadyStarted?: boolean;
  alreadyStopped?: boolean;
  error?: string;
  message?: string;
  boardId?: string;
  snapshot?: BoardSnapshot;
};

export type AdminGameSettings = GameSettings & {
  submitWindowMs: number;
  resolveWindowMs: number;
};

export type AdminSettingsResponse = {
  ok: boolean;
  error?: string;
  message?: string;
  settings: AdminGameSettings;
};

type AdminRequestOptions = {
  apiBase: string;
  token: string;
};

type PromptRunnerHealth = {
  ok: boolean;
  manifests: number;
  jobs: number;
  activeJobs: number;
  maxActiveJobsGlobal: number;
  maxActiveJobsPerOwner: number;
  dataDir: string;
};

export type PromptRunnerPurgeResponse = {
  ok: boolean;
  cleared: {
    manifests: number;
    jobs: number;
    logs: number;
  };
  dataDir: string;
};

type StoredManifestSummary = {
  id: string;
  ownerId: string;
  revision: number;
  createdAt: string;
  updatedAt: string;
  displayName: string;
};

export type PromptDraft = {
  manifestId: string;
  ownerId: string;
  requestedBy: string;
  heroName: string;
  displayName: string;
  strategy: string;
  preferredTrait: PromptManifest["agent"]["preferredTrait"];
  system: string;
  policy: string;
  persona: string;
  styleNotes: string;
  profile: string;
  temperature: string;
  maxOutputTokens: string;
  reasoningEffort: "low" | "medium" | "high";
  decisionTimeoutMs: string;
  maxDecisionRetries: string;
  maxConsecutiveFallbacks: string;
  cooldownMs: string;
};

export type PromptRunnerStateResponse = {
  health: PromptRunnerHealth;
  manifests: StoredManifestSummary[];
  jobs: PromptRunnerJob[];
};

type PromptRunnerFetchOptions = {
  base: string;
  token: string;
};

type PromptRunnerStoreManifestRequest = {
  manifestId: string;
  ownerId: string;
  manifest: PromptManifest;
};

type PromptRunnerCreateJobRequest = {
  manifestId: string;
  connection: {
    baseUrl: string;
  };
  hero: {
    id?: string;
    name: string;
  };
  requestedBy: string;
};

export function createDefaultPromptDraft(): PromptDraft {
  const seed = Date.now().toString(36);
  return {
    manifestId: `treasure-mind-${seed}`,
    ownerId: "dashboard-local",
    requestedBy: "dashboard-operator",
    heroName: "Hosted Treasure Mind",
    displayName: "Treasure Mind",
    strategy: "prefer treasure, avoid obviously bad fights, and escape alive",
    preferredTrait: "greedy",
    system:
      "You are a Neural Necropolis hero controller. Use only the latest observation and the legal actions list. Choose exactly one legal action and never invent actions.",
    policy:
      "Prioritize immediate survival first, then treasure, then safe exploration. Avoid actions that step into obviously bad monster punish windows when a safer legal alternative exists.",
    persona: "You are cool-headed, practical, and loot-motivated.",
    styleNotes:
      "Keep reasoning short and concrete. Do not narrate lore or roleplay beyond the chosen action rationale.",
    profile: "balanced-production",
    temperature: "0.3",
    maxOutputTokens: "180",
    reasoningEffort: "medium",
    decisionTimeoutMs: "15000",
    maxDecisionRetries: "1",
    maxConsecutiveFallbacks: "3",
    cooldownMs: "150",
  };
}

export function buildPromptManifest(draft: PromptDraft): PromptManifest {
  return {
    manifestVersion: "1.0",
    kind: "neural-necropolis.prompt-manifest",
    agent: {
      displayName: draft.displayName.trim(),
      strategy: draft.strategy.trim(),
      preferredTrait: draft.preferredTrait,
    },
    prompts: {
      system: draft.system.trim(),
      policy: draft.policy.trim(),
      persona: draft.persona.trim(),
      styleNotes: draft.styleNotes.trim(),
    },
    model: {
      selection: { mode: "profile", profile: draft.profile.trim() },
      temperature: Number(draft.temperature || 0.3),
      maxOutputTokens: Number(draft.maxOutputTokens || 180),
      reasoningEffort: draft.reasoningEffort,
    },
    runner: {
      decisionTimeoutMs: Number(draft.decisionTimeoutMs || 15000),
      maxDecisionRetries: Number(draft.maxDecisionRetries || 1),
      maxConsecutiveFallbacks: Number(draft.maxConsecutiveFallbacks || 3),
      cooldownMs: Number(draft.cooldownMs || 150),
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
      ownerId: draft.ownerId.trim(),
      createdBy: draft.requestedBy.trim(),
      revision: 1,
      labels: ["dashboard", "hosted-agent"],
      notes: "Drafted from the Hosted Agents dashboard app.",
    },
  };
}

export async function fetchPromptRunnerState(
  options: PromptRunnerFetchOptions,
): Promise<PromptRunnerStateResponse> {
  const [health, manifests, jobs] = await Promise.all([
    promptRunnerFetchJson<PromptRunnerHealth>(options, "/health"),
    promptRunnerFetchJson<StoredManifestSummary[]>(options, "/manifests"),
    promptRunnerFetchJson<PromptRunnerJob[]>(options, "/jobs"),
  ]);

  return { health, manifests, jobs };
}

export function fetchPromptRunnerLogs(
  options: PromptRunnerFetchOptions,
  jobId: string,
): Promise<JobLogEntry[]> {
  return promptRunnerFetchJson<JobLogEntry[]>(
    options,
    `/jobs/${encodeURIComponent(jobId)}/logs`,
  );
}

export function storePromptRunnerManifest(
  options: PromptRunnerFetchOptions,
  request: PromptRunnerStoreManifestRequest,
): Promise<StoredManifestRecord> {
  return promptRunnerFetchJson<StoredManifestRecord>(options, "/manifests", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(request),
  });
}

export function createPromptRunnerJob(
  options: PromptRunnerFetchOptions,
  request: PromptRunnerCreateJobRequest,
): Promise<PromptRunnerJob> {
  return promptRunnerFetchJson<PromptRunnerJob>(options, "/jobs", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(request),
  });
}

export function cancelPromptRunnerJob(
  options: PromptRunnerFetchOptions,
  jobId: string,
): Promise<PromptRunnerJob> {
  return promptRunnerFetchJson<PromptRunnerJob>(
    options,
    `/jobs/${encodeURIComponent(jobId)}/cancel`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
    },
  );
}

export function purgePromptRunnerData(
  options: PromptRunnerFetchOptions,
): Promise<PromptRunnerPurgeResponse> {
  return promptRunnerFetchJson<PromptRunnerPurgeResponse>(
    options,
    "/admin/purge",
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
    },
  );
}

export function fetchAdminSettings(
  options: AdminRequestOptions,
): Promise<AdminGameSettings> {
  return adminFetchJson<AdminGameSettings>(options, "/api/admin/settings", {
    method: "GET",
  });
}

export function updateAdminSettings(
  options: AdminRequestOptions,
  settings: AdminGameSettings,
): Promise<AdminSettingsResponse> {
  return adminFetchJson<AdminSettingsResponse>(options, "/api/admin/settings", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(settings),
  });
}

export function startBoard(
  options: AdminRequestOptions,
): Promise<AdminSnapshotResponse> {
  return adminFetchJson<AdminSnapshotResponse>(options, "/api/admin/start", {
    method: "POST",
  });
}

export function stopBoard(
  options: AdminRequestOptions,
): Promise<AdminSnapshotResponse> {
  return adminFetchJson<AdminSnapshotResponse>(options, "/api/admin/stop", {
    method: "POST",
  });
}

export function resetBoard(
  options: AdminRequestOptions,
): Promise<AdminSnapshotResponse> {
  return adminFetchJson<AdminSnapshotResponse>(options, "/api/admin/reset", {
    method: "POST",
  });
}

// ── Arena API ──

export function fetchArenas(apiBase: string): Promise<ArenaListResponse> {
  return fetchJson<ArenaListResponse>(`${apiBase}/api/arena`);
}

export function fetchArena(
  apiBase: string,
  arenaId: string,
): Promise<ArenaSnapshot> {
  return fetchJson<ArenaSnapshot>(
    `${apiBase}/api/arena/${encodeURIComponent(arenaId)}`,
  );
}

export function createArena(
  options: AdminRequestOptions,
  request: CreateArenaRequest,
): Promise<ArenaSnapshot> {
  return adminFetchJson<ArenaSnapshot>(options, "/api/arena", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(request),
  });
}

export function addArenaMatch(
  options: AdminRequestOptions,
  arenaId: string,
  request: AddMatchRequest,
): Promise<ArenaMatchSnapshot> {
  return adminFetchJson<ArenaMatchSnapshot>(
    options,
    `/api/arena/${encodeURIComponent(arenaId)}/matches`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(request),
    },
  );
}

export function startArena(
  options: AdminRequestOptions,
  arenaId: string,
): Promise<ArenaSnapshot> {
  return adminFetchJson<ArenaSnapshot>(
    options,
    `/api/arena/${encodeURIComponent(arenaId)}/start`,
    {
      method: "POST",
    },
  );
}

async function promptRunnerFetchJson<T>(
  options: PromptRunnerFetchOptions,
  path: string,
  init?: RequestInit,
): Promise<T> {
  const headers = new Headers(init?.headers ?? undefined);
  if (options.token.trim()) {
    headers.set("Authorization", `Bearer ${options.token.trim()}`);
  }

  const response = await fetch(`${options.base}${path}`, {
    ...init,
    headers,
  });
  const text = await response.text();
  const data = text ? (JSON.parse(text) as T | { message?: string }) : null;

  if (!response.ok) {
    const message =
      typeof data === "object" && data && "message" in data
        ? String(data.message || response.statusText)
        : response.statusText;
    throw new Error(message || `Request failed with ${response.status}`);
  }

  return data as T;
}

async function adminFetchJson<T>(
  options: AdminRequestOptions,
  path: string,
  init?: RequestInit,
): Promise<T> {
  const headers = new Headers(init?.headers ?? undefined);
  if (options.token.trim()) {
    headers.set("Authorization", `Bearer ${options.token.trim()}`);
  }

  const response = await fetch(`${options.apiBase}${path}`, {
    ...init,
    headers,
  });
  const text = await response.text();
  const data = text
    ? (JSON.parse(text) as T | { error?: string; message?: string })
    : null;

  if (!response.ok) {
    const message =
      typeof data === "object" && data
        ? String(
            ("message" in data && data.message) ||
              ("error" in data && data.error) ||
              response.statusText,
          )
        : response.statusText;
    throw new Error(message || `Request failed with ${response.status}`);
  }

  return data as T;
}
