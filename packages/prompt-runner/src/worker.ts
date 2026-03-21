import { HeroApi, type HeroAction } from "@neural-necropolis/agent-sdk";
import type { LegalAction, VisionData } from "@neural-necropolis/protocol-ts";
import { requestModelCompletion, resolveModelConfig } from "./model.js";
import {
  appendJobLog,
  readJobRecord,
  readManifestRecord,
  updateJobRecord,
} from "./store.js";
import type {
  FallbackAction,
  JobLogLevel,
  JsonValue,
  PromptManifest,
  PromptRunnerJob,
  RunnerDecision,
  RunnerPaths,
} from "./types.js";

const DEFAULT_LOOP_DELAY_MS = 150;

export async function runWorkerJob(
  paths: RunnerPaths,
  jobId: string,
): Promise<void> {
  const job = await readJobRecord(paths, jobId);
  if (!job) {
    throw new Error(`Unknown job ${jobId}`);
  }
  const manifestRecord = await readManifestRecord(paths, job.manifestId);
  if (!manifestRecord) {
    throw new Error(`Unknown manifest ${job.manifestId}`);
  }

  const log = createLogger(paths, job.id);

  await updateJobRecord(paths, job.id, (current) => ({
    ...current,
    status: "running",
    startedAt: current.startedAt ?? new Date().toISOString(),
    workerPid: process.pid,
  }));

  try {
    const model = resolveModelConfig(manifestRecord.manifest);
    await updateJobRecord(paths, job.id, (current) => ({
      ...current,
      selectedModel: {
        provider: model.provider,
        model: model.model,
        profile: model.profile,
      },
    }));
    await log(
      "info",
      `worker started with ${model.provider}/${model.model}${model.profile ? ` via profile ${model.profile}` : ""}`,
    );

    const result = await playBoard(paths, job, manifestRecord.manifest, log);

    await updateJobRecord(paths, job.id, (current) => ({
      ...current,
      status: "completed",
      finishedAt: new Date().toISOString(),
      terminalState: result.terminalState,
      lastBoardId: result.boardId,
      lastTurn: result.turn,
    }));
    await log(
      "info",
      `job completed on ${result.boardId} at turn ${result.turn} with hero state ${result.terminalState}`,
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await updateJobRecord(paths, job.id, (current) => ({
      ...current,
      status: "failed",
      finishedAt: new Date().toISOString(),
      failureCode: "worker_failed",
      failureMessage: message,
    }));
    await log("error", `job failed: ${message}`);
    throw error;
  }
}

async function playBoard(
  paths: RunnerPaths,
  job: PromptRunnerJob,
  manifest: PromptManifest,
  log: (level: JobLogLevel, message: string, data?: unknown) => Promise<void>,
): Promise<{
  boardId: string;
  turn: number;
  terminalState: "alive" | "dead" | "escaped" | "unknown";
}> {
  const api = new HeroApi(job.connection, job.hero);
  api.startLeaseKeepalive({
    onError(error) {
      void log("warn", `keepalive error: ${error.code}:${error.message}`);
    },
  });

  let lastSubmittedTurnKey = "";

  try {
    const registration = await api.register();
    await log(
      "info",
      `registered ${job.hero.name} on ${registration.boardId}`,
      { boardId: registration.boardId },
    );

    while (true) {
      const vision = await api.observe();
      const turnState = vision.turnState ?? api.turnState;

      await updateJobRecord(paths, job.id, (current) => ({
        ...current,
        lastBoardId: vision.boardId,
        lastTurn: vision.turn,
      }));

      if (
        vision.boardStatus === "completed" ||
        vision.hero.status !== "alive"
      ) {
        return {
          boardId: vision.boardId,
          turn: vision.turn,
          terminalState:
            vision.hero.status === "alive" ? "unknown" : vision.hero.status,
        };
      }

      if (!turnState || !turnState.started) {
        await api.maybeHeartbeat();
        await sleep(500);
        continue;
      }

      if (turnState.phase !== "submit") {
        await api.maybeHeartbeat();
        await sleep(
          Math.max(100, millisUntilPhaseBoundary(turnState.phaseEndsAt)),
        );
        continue;
      }

      const turnKey = `${vision.boardId}:${turnState.turn}`;
      if (turnKey === lastSubmittedTurnKey) {
        await api.maybeHeartbeat();
        await sleep(DEFAULT_LOOP_DELAY_MS);
        continue;
      }

      const decision = await chooseDecision(manifest, vision, log);
      const selectedAction = selectMatchingAction(
        vision.legalActions,
        decision.action,
      );
      const result = await api.act(selectedAction);
      lastSubmittedTurnKey = turnKey;

      await updateJobRecord(paths, job.id, (current) => ({
        ...current,
        attempts: current.attempts + 1,
        consecutiveFallbacks:
          decision.source === "fallback" ? current.consecutiveFallbacks + 1 : 0,
      }));

      const updated = await readJobRecord(paths, job.id);
      if (
        decision.source === "fallback" &&
        manifest.runner.maxConsecutiveFallbacks != null &&
        (updated?.consecutiveFallbacks ?? 0) >
          manifest.runner.maxConsecutiveFallbacks
      ) {
        throw new Error(
          `Exceeded maxConsecutiveFallbacks=${manifest.runner.maxConsecutiveFallbacks}`,
        );
      }

      await log(
        "info",
        `submitted ${describeAction(selectedAction)} (${decision.source})`,
        {
          accepted: result.accepted,
          requestId: result.requestId,
          reason: decision.reason,
          fallbackUsed: decision.fallbackUsed,
        },
      );
      await sleep(
        Math.max(DEFAULT_LOOP_DELAY_MS, manifest.runner.cooldownMs ?? 0),
      );
    }
  } finally {
    api.stopLeaseKeepalive();
  }
}

async function chooseDecision(
  manifest: PromptManifest,
  vision: VisionData,
  log: (level: JobLogLevel, message: string, data?: unknown) => Promise<void>,
): Promise<RunnerDecision> {
  const model = resolveModelConfig(manifest);
  const systemPrompt = buildSystemPrompt(manifest);
  const userPrompt = buildUserPrompt(vision);

  for (
    let attempt = 0;
    attempt <= manifest.runner.maxDecisionRetries;
    attempt += 1
  ) {
    try {
      const content = await requestModelCompletion(
        model,
        systemPrompt,
        userPrompt,
        manifest.runner.decisionTimeoutMs,
      );
      const parsed = parseDecisionText(
        content,
        vision.legalActions.length,
        manifest.io.requireReason,
      );
      return {
        action: vision.legalActions[parsed.index],
        reason: parsed.reason,
        source: "model",
      };
    } catch (error) {
      const classification = classifyDecisionError(error);
      const isFinalAttempt = attempt >= manifest.runner.maxDecisionRetries;
      if (!isFinalAttempt) {
        await log(
          "warn",
          `decision attempt ${attempt + 1} failed: ${classification.kind}`,
          {
            message: classification.message,
          },
        );
        await sleep(
          Math.max(DEFAULT_LOOP_DELAY_MS, manifest.runner.cooldownMs ?? 0),
        );
        continue;
      }

      const fallbackPolicy =
        classification.kind === "timeout"
          ? manifest.fallback.onTimeout
          : classification.kind === "unsafe"
            ? manifest.fallback.onUnsafeOutput
            : manifest.fallback.onMalformedOutput;
      await log(
        "warn",
        `using ${fallbackPolicy} fallback after ${classification.kind}`,
        {
          message: classification.message,
        },
      );
      return applyFallback(
        fallbackPolicy,
        vision.legalActions,
        classification.message,
      );
    }
  }

  return applyFallback(
    manifest.fallback.onMalformedOutput,
    vision.legalActions,
    "decision loop exhausted unexpectedly",
  );
}

function buildSystemPrompt(manifest: PromptManifest): string {
  return [
    "You are a hosted Neural Necropolis prompt runner. Use only the current observation and the legal actions list.",
    manifest.prompts.system,
    `Policy: ${manifest.prompts.policy}`,
    manifest.prompts.persona ? `Persona: ${manifest.prompts.persona}` : "",
    manifest.prompts.styleNotes
      ? `Style notes: ${manifest.prompts.styleNotes}`
      : "",
    "Reply in plain text only.",
    "Format:",
    "ACTION: <zero-based index>",
    manifest.io.requireReason
      ? "REASON: <brief one-sentence explanation>"
      : "REASON: optional",
    "Choose exactly one legal action index. Never invent actions.",
  ]
    .filter((line) => line.length > 0)
    .join("\n\n");
}

function buildUserPrompt(vision: VisionData): string {
  const hero = vision.hero;
  const effects =
    hero.effects
      .map((effect) => `${effect.kind}:${effect.turnsRemaining}`)
      .join(", ") || "none";
  const inventory =
    hero.inventory.map((item) => item.name).join(", ") || "empty";
  const monsters =
    vision.visibleMonsters
      .map(
        (monster) =>
          `${monster.name} (${monster.kind}) hp ${monster.hp}/${monster.maxHp} at (${monster.position.x},${monster.position.y})`,
      )
      .join("; ") || "none";
  const items =
    vision.visibleItems
      .map(
        (item) =>
          `${item.item.name} at (${item.position.x},${item.position.y})`,
      )
      .join("; ") || "none";
  const npcs =
    vision.visibleNpcs
      .map(
        (npc) =>
          `${npc.name} (${npc.kind}) at (${npc.position.x},${npc.position.y})`,
      )
      .join("; ") || "none";
  const events =
    vision.recentEvents
      .slice(-6)
      .map((event) => `turn ${event.turn}: ${event.summary}`)
      .join("; ") || "none";
  const legalActions = vision.legalActions
    .map((action, index) => `${index}. ${action.description}`)
    .join("\n");

  return [
    `Board: ${vision.boardId} | Turn: ${vision.turn} | Status: ${vision.boardStatus} | Phase: ${vision.turnState.phase}`,
    `Hero: ${hero.name} at (${hero.position.x},${hero.position.y}) | HP ${hero.stats.hp}/${hero.stats.maxHp} | fatigue ${hero.fatigue} | morale ${hero.morale} | gold ${hero.gold} | score ${hero.score}`,
    `Effects: ${effects}`,
    `Inventory: ${inventory}`,
    `Visible monsters: ${monsters}`,
    `Visible items: ${items}`,
    `Visible NPCs: ${npcs}`,
    `Recent events: ${events}`,
    "Legal actions:",
    legalActions,
  ].join("\n\n");
}

function parseDecisionText(
  text: string,
  legalActionCount: number,
  requireReason: boolean,
): { index: number; reason: string } {
  const normalized = text.trim();
  if (!normalized) {
    throw new Error("Malformed model output: empty response");
  }
  const actionMatch = normalized.match(/ACTION:\s*(\d+)/i);
  if (!actionMatch) {
    throw new Error("Malformed model output: missing ACTION line");
  }
  const index = Number.parseInt(actionMatch[1], 10);
  if (!Number.isInteger(index)) {
    throw new Error("Malformed model output: invalid action index");
  }
  if (index < 0 || index >= legalActionCount) {
    const error = new Error(
      `Unsafe model output: action index ${index} is out of range`,
    );
    error.name = "UnsafeDecisionError";
    throw error;
  }
  const reasonMatch = normalized.match(/REASON:\s*(.+)$/im);
  const reason = reasonMatch?.[1]?.trim() ?? "";
  if (requireReason && reason.length === 0) {
    throw new Error("Malformed model output: missing REASON line");
  }
  return { index, reason: reason || "model selected a legal action" };
}

function classifyDecisionError(error: unknown): {
  kind: "timeout" | "malformed" | "unsafe";
  message: string;
} {
  const message = error instanceof Error ? error.message : String(error);
  if (error instanceof Error && error.name === "UnsafeDecisionError") {
    return { kind: "unsafe", message };
  }
  if (/timeout|aborted/i.test(message)) {
    return { kind: "timeout", message };
  }
  if (/unsafe/i.test(message)) {
    return { kind: "unsafe", message };
  }
  return { kind: "malformed", message };
}

function applyFallback(
  fallback: FallbackAction,
  legalActions: LegalAction[],
  cause: string,
): RunnerDecision {
  const action = selectFallbackAction(fallback, legalActions);
  return {
    action,
    reason: `fallback ${fallback}: ${cause}`,
    source: "fallback",
    fallbackUsed: fallback,
  };
}

function selectFallbackAction(
  fallback: FallbackAction,
  legalActions: LegalAction[],
): HeroAction {
  if (legalActions.length === 0) {
    return { kind: "wait" };
  }
  if (fallback === "rest") {
    return (
      legalActions.find((action) => action.kind === "rest") ??
      legalActions.find((action) => action.kind === "wait") ??
      legalActions[0]
    );
  }
  if (fallback === "wait" || fallback === "reject_turn") {
    return (
      legalActions.find((action) => action.kind === "wait") ??
      legalActions.find((action) => action.kind === "rest") ??
      legalActions[0]
    );
  }
  return legalActions[0];
}

function selectMatchingAction(
  legalActions: LegalAction[],
  action: HeroAction,
): HeroAction {
  return (
    legalActions.find((candidate) => actionsEqual(candidate, action)) ?? action
  );
}

function actionsEqual(left: HeroAction, right: HeroAction): boolean {
  return (
    left.kind === right.kind &&
    left.direction === right.direction &&
    left.targetId === right.targetId &&
    left.itemId === right.itemId
  );
}

function describeAction(action: HeroAction): string {
  if (action.kind === "move" && action.direction) {
    return `move ${action.direction}`;
  }
  if (action.kind === "attack" && action.targetId) {
    return `attack ${action.targetId}`;
  }
  if (action.kind === "use_item" && action.itemId) {
    return `use_item ${action.itemId}`;
  }
  return action.kind;
}

function millisUntilPhaseBoundary(phaseEndsAt: number): number {
  return Math.max(
    DEFAULT_LOOP_DELAY_MS,
    Math.min(1_000, phaseEndsAt - Date.now() + 25),
  );
}

function createLogger(paths: RunnerPaths, jobId: string) {
  return async (
    level: JobLogLevel,
    message: string,
    data?: unknown,
  ): Promise<void> => {
    await appendJobLog(paths, jobId, {
      timestamp: new Date().toISOString(),
      level,
      message,
      data: sanitizeLogData(data),
    });
    const suffix =
      data == null ? "" : ` ${JSON.stringify(sanitizeLogData(data))}`;
    const writer =
      level === "error"
        ? console.error
        : level === "warn"
          ? console.warn
          : console.log;
    writer(`[prompt-runner:${jobId}] ${message}${suffix}`);
  };
}

function sanitizeLogData(data: unknown) {
  if (data == null) {
    return undefined;
  }
  return JSON.parse(JSON.stringify(data)) as JsonValue;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
