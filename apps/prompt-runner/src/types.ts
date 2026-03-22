import type {
  HeroAction,
  HeroConnectionOptions,
  HeroRegistration,
} from "@neural-necropolis/agent-sdk";

export type JsonValue =
  | null
  | boolean
  | number
  | string
  | JsonValue[]
  | { [key: string]: JsonValue };

export type JsonObject = { [key: string]: JsonValue };

export type PromptManifest = {
  manifestVersion: "1.0";
  kind: "neural-necropolis.prompt-manifest";
  agent: {
    displayName: string;
    strategy: string;
    preferredTrait:
      | "aggressive"
      | "cautious"
      | "greedy"
      | "curious"
      | "resilient";
  };
  prompts: {
    system: string;
    policy: string;
    persona?: string;
    styleNotes?: string;
  };
  model: {
    selection:
      | {
          mode: "profile";
          profile: string;
        }
      | {
          mode: "direct";
          provider:
            | "openai"
            | "groq"
            | "together"
            | "fireworks"
            | "perplexity"
            | "ollama"
            | "openai-compatible";
          model: string;
        };
    temperature: number;
    maxOutputTokens: number;
    reasoningEffort?: "low" | "medium" | "high";
  };
  runner: {
    decisionTimeoutMs: number;
    maxDecisionRetries: number;
    maxConsecutiveFallbacks?: number;
    cooldownMs?: number;
  };
  io: {
    inputMode: "observation-v1";
    outputMode: "action-index-v1";
    requireReason: boolean;
  };
  tools: {
    mode: "none" | "allowlist";
    allowed: string[];
  };
  fallback: {
    onTimeout: FallbackAction;
    onMalformedOutput: FallbackAction;
    onUnsafeOutput: FallbackAction;
  };
  metadata?: {
    ownerId?: string;
    createdBy?: string;
    revision?: number;
    labels?: string[];
    notes?: string;
  };
};

export type StoredManifestRecord = {
  id: string;
  ownerId: string;
  revision: number;
  createdAt: string;
  updatedAt: string;
  manifest: PromptManifest;
};

export type JobStatus =
  | "queued"
  | "running"
  | "completed"
  | "failed"
  | "cancelled";

export type JobTerminalState = "alive" | "dead" | "escaped" | "unknown";

export type PromptRunnerJob = {
  id: string;
  manifestId: string;
  ownerId: string;
  status: JobStatus;
  createdAt: string;
  startedAt?: string;
  finishedAt?: string;
  requestedBy?: string;
  workerPid?: number;
  connection: HeroConnectionOptions;
  hero: HeroRegistration;
  lastBoardId?: string;
  lastTurn?: number;
  attempts: number;
  consecutiveFallbacks: number;
  terminalState?: JobTerminalState;
  failureCode?: string;
  failureMessage?: string;
  selectedModel?: {
    provider: string;
    model: string;
    profile?: string;
  };
};

export type PromptRunnerJobCreateRequest = {
  manifestId: string;
  connection?: HeroConnectionOptions;
  hero?: {
    id?: string;
    name?: string;
  };
  requestedBy?: string;
};

export type JobLogLevel = "info" | "warn" | "error";

export type JobLogEntry = {
  timestamp: string;
  level: JobLogLevel;
  message: string;
  data?: JsonValue;
};

export type FallbackAction = "wait" | "rest" | "first_legal" | "reject_turn";

export type RunnerDecision = {
  action: HeroAction;
  reason: string;
  source: "model" | "fallback";
  fallbackUsed?: FallbackAction;
};

export type RunnerPaths = {
  dataDir: string;
  manifestsDir: string;
  jobsDir: string;
  logsDir: string;
};

export type ModelProfile = {
  provider: string;
  model: string;
  baseUrl?: string;
  apiKeyEnv?: string;
  apiKey?: string;
  includeReasoning?: boolean;
};

export type ResolvedModelConfig = {
  provider: string;
  model: string;
  baseUrl: string;
  apiKey: string;
  temperature: number;
  maxOutputTokens: number;
  reasoningEffort?: "low" | "medium" | "high";
  includeReasoning?: boolean;
  profile?: string;
};
