import type {
  BoardSummary,
  BotMessage,
  DashboardResponse,
  EventRecord,
  HeroProfile,
  LobbyInfo,
  TurnState,
} from "@neural-necropolis/protocol-ts";

import type { StreamConnectionState, StreamLogEntry } from "./dashboardStore";

export type FeedItem = {
  id: string;
  label: string;
  detail: string;
  sortKey: number;
  tone?: "combat" | "loot" | "effect" | "movement" | "system" | "bot";
};

export type HeaderStatus = {
  label: string;
  tone: "waiting" | "ready" | "running" | "completed";
  attached: string;
  phase: string;
};

export type LauncherChecklistItem = {
  label: string;
  detail: string;
  state: "ready" | "todo" | "blocked";
};

export type LauncherState = {
  headline: string;
  nextAction: string;
  checklist: LauncherChecklistItem[];
};

export function formatHealthLabel(query: {
  isLoading: boolean;
  isError: boolean;
  data?: { ok?: boolean };
}): string {
  if (query.isLoading) {
    return "Checking";
  }
  if (query.isError) {
    return "Unavailable";
  }
  if (query.data?.ok) {
    return "Reachable";
  }
  return "Unknown";
}

export function formatStreamStateLabel(state: StreamConnectionState): string {
  switch (state) {
    case "connecting":
      return "Connecting";
    case "live":
      return "Live";
    case "retrying":
      return "Retrying";
    case "error":
      return "Unavailable";
    default:
      return "Idle";
  }
}

export function shouldApplyStreamSnapshot(
  selectedBoardId: string | null,
  snapshot: DashboardResponse,
): boolean {
  return !selectedBoardId || selectedBoardId === snapshot.boardId;
}

export function deriveSelectedBoardSummary(
  boards: BoardSummary[],
  selectedBoardId: string | null,
  snapshot: DashboardResponse | null,
): BoardSummary | null {
  if (selectedBoardId) {
    const selected = boards.find((board) => board.boardId === selectedBoardId);
    if (selected) {
      return selected;
    }
  }
  if (!snapshot) {
    return boards[0] ?? null;
  }
  return boards.find((board) => board.boardId === snapshot.boardId) ?? null;
}

function buildPhaseLabel(snapshot: DashboardResponse | null): string {
  if (!snapshot) return "";
  const ts = snapshot.turnState;
  const lobby = snapshot.lobby;
  const paused = snapshot.gameSettings?.paused;
  if (ts?.started) {
    return `Turn ${ts.turn} \u00b7 ${ts.phase.toUpperCase()}`;
  }
  if (lobby.status === "completed") return "COMPLETED";
  if (paused) return "PAUSED";
  if ((lobby.joinWindowRemainingMs ?? 0) > 0) return "JOIN WINDOW";
  if (lobby.queueStatus === "ready to start") return "READY";
  if (lobby.queueStatus === "waiting for more heroes") return "LOBBY";
  return lobby.status?.toUpperCase() ?? "";
}

export function buildHeaderStatus(
  snapshot: DashboardResponse | null,
): HeaderStatus {
  const lobby = snapshot?.lobby;
  if (!lobby) {
    return {
      label: "Board waiting",
      tone: "waiting",
      attached: "0/0",
      phase: "",
    };
  }
  const required = lobby.requiredHeroes ?? lobby.maxHeroes;
  const attached = `${lobby.attachedHeroes}/${required}`;
  const phase = buildPhaseLabel(snapshot);
  if (lobby.status === "running") {
    return { label: "Board running", tone: "running", attached, phase };
  }
  if (lobby.status === "completed") {
    return { label: "Board completed", tone: "completed", attached, phase };
  }
  if (lobby.canStart) {
    return { label: "Board ready", tone: "ready", attached, phase };
  }
  return { label: "Waiting for more heroes", tone: "waiting", attached, phase };
}

export function buildControlNotice(snapshot: DashboardResponse | null): string {
  if (!snapshot) {
    return "Waiting for the first dashboard snapshot from the engine.";
  }
  const lobby = snapshot.lobby;
  const paused = snapshot.gameSettings.paused;
  const attached = lobby.requiredHeroes
    ? `${lobby.attachedHeroes}/${lobby.requiredHeroes}`
    : String(lobby.attachedHeroes);
  if (paused) {
    if (lobby.status === "running") {
      return "Turns are OFF. This board is paused mid-run and will resume from the current turn when you enable turns.";
    }
    if (lobby.attachedHeroes > 0 && (lobby.joinWindowRemainingMs ?? 0) > 0) {
      return `Turns are OFF. This board has not started. ${attached} heroes are attached and the join window is still open.`;
    }
    if (lobby.attachedHeroes > 0 && lobby.canStart) {
      return `Turns are OFF. This board has not started. ${attached} heroes are attached and the board will start immediately when turns are enabled.`;
    }
    return "Turns are OFF. Start agents separately, then enable turns when you want the active board to progress.";
  }
  if (lobby.status === "completed") {
    return (
      lobby.completionReason ||
      "This board is complete. A queued board will take over automatically."
    );
  }
  if (lobby.status === "running") {
    return `Turn cycle: ${(snapshot.turnState.submitWindowMs / 1000).toFixed(1)}s submit + ${(snapshot.turnState.resolveWindowMs / 1000).toFixed(1)}s resolve.`;
  }
  if ((lobby.joinWindowRemainingMs ?? 0) > 0) {
    return `Turns are ON. This board is staged with ${attached} heroes and is waiting for the join window to finish or fill.`;
  }
  if (lobby.canStart) {
    return "Turns are ON. This board is ready and will start on the next auto-start check.";
  }
  return "Board waiting.";
}

export function buildBoardSummaryStats(snapshot: DashboardResponse | null) {
  if (!snapshot) {
    return [] as Array<{ label: string; value: string }>;
  }
  return [
    { label: "Phase", value: formatPhase(snapshot.turnState, snapshot.lobby) },
    {
      label: "Queue",
      value: snapshot.lobby.queueStatus || snapshot.lobby.status,
    },
    { label: "Heroes", value: `${snapshot.heroes.length} attached` },
    { label: "Monsters", value: `${snapshot.monsters.length} on board` },
  ];
}

export function buildLauncherState(input: {
  boards: BoardSummary[];
  serverReachable: boolean;
  snapshot: DashboardResponse | null;
}): LauncherState {
  const { boards, serverReachable, snapshot } = input;
  const attachedHeroes = snapshot?.lobby.attachedHeroes ?? 0;
  const turnsPaused = snapshot?.gameSettings.paused ?? true;
  const activeBoardName =
    snapshot?.world.dungeonName ?? boards[0]?.boardName ?? "board";

  const checklist: LauncherChecklistItem[] = [
    {
      label: "Server",
      detail: serverReachable
        ? "Engine API is reachable."
        : "Start the engine first.",
      state: serverReachable ? "ready" : "blocked",
    },
    {
      label: "Board",
      detail:
        boards.length > 0
          ? `${boards.length} boards available.`
          : "Waiting for the first board.",
      state: boards.length > 0 ? "ready" : "todo",
    },
    {
      label: "Heroes",
      detail:
        attachedHeroes > 0
          ? `${attachedHeroes} heroes attached to ${activeBoardName}.`
          : `No heroes attached to ${activeBoardName} yet.`,
      state: attachedHeroes > 0 ? "ready" : "todo",
    },
    {
      label: "Turns",
      detail: turnsPaused
        ? "Turns are OFF. Enable them from the built-in dashboard controls."
        : "Turns are running.",
      state: turnsPaused ? "todo" : "ready",
    },
  ];

  if (!serverReachable) {
    return {
      headline: "Start the server",
      nextAction: "Run the engine, then reload this dashboard.",
      checklist,
    };
  }

  if (attachedHeroes === 0) {
    return {
      headline: "Attach your first hero",
      nextAction:
        "Run a local demo or attach a scripted, AI, or OpenClaw bot to this server.",
      checklist,
    };
  }

  if (turnsPaused) {
    return {
      headline: "Start the run",
      nextAction:
        "Open the built-in dashboard controls and switch Turns ON when you want the board to progress.",
      checklist,
    };
  }

  return {
    headline: "Run is live",
    nextAction:
      "Watch the map and feed, or open Hosted Agents to launch another hero workflow.",
    checklist,
  };
}

export function formatHeroStatus(hero: HeroProfile, lobby: LobbyInfo): string {
  if (isInactiveHero(hero)) {
    return "inactive";
  }
  if (hero.status !== "alive") {
    return hero.status;
  }
  if (lobby.status === "running") {
    return "running";
  }
  if (lobby.status === "completed") {
    return "completed";
  }
  return "staged";
}

export function formatPhase(turnState: TurnState, lobby: LobbyInfo): string {
  if (turnState.started) {
    return turnState.phase.toUpperCase();
  }
  if (lobby.status === "completed") {
    return "COMPLETED";
  }
  if ((lobby.joinWindowRemainingMs ?? 0) > 0) {
    return "JOIN WINDOW";
  }
  if (lobby.canStart) {
    return "READY";
  }
  return "LOBBY";
}

function isInactiveHero(hero: HeroProfile): boolean {
  return (
    hero.status === "alive" &&
    hero.lastAction.toLowerCase() === "session expired"
  );
}

export function buildFeedItems(
  snapshot: DashboardResponse | null,
  streamLogs: StreamLogEntry[],
): FeedItem[] {
  const eventItems = (snapshot?.recentEvents ?? []).map(toEventFeedItem);
  const botItems = (snapshot?.botMessages ?? []).map(toBotFeedItem);
  const streamItems = streamLogs.map((entry) => ({
    id: entry.id,
    label: formatStreamLogLabel(entry),
    detail: entry.message,
    sortKey: entry.createdAt,
    tone: classifyFeedTone(entry.message),
  }));

  return [...streamItems, ...botItems, ...eventItems]
    .sort((left, right) => right.sortKey - left.sortKey)
    .slice(0, 24);
}

function formatStreamLogLabel(entry: StreamLogEntry): string {
  const segments = ["Stream"];

  if (entry.arenaId) {
    segments.push(`Arena ${shortId(entry.arenaId)}`);
  }
  if (entry.matchId) {
    segments.push(`Match ${shortId(entry.matchId)}`);
  }
  if (entry.duelIndex != null) {
    segments.push(`Duel ${entry.duelIndex + 1}`);
  }
  if (
    !entry.arenaId &&
    !entry.matchId &&
    entry.duelIndex == null &&
    entry.boardId
  ) {
    segments.push(entry.boardId);
  }

  return segments.join(" · ");
}

function shortId(value: string): string {
  return value.length > 8 ? value.slice(0, 8) : value;
}

function toEventFeedItem(event: EventRecord): FeedItem {
  return {
    id: event.id,
    label: `Turn ${event.turn} · ${event.type}`,
    detail: event.summary,
    sortKey: event.turn,
    tone: classifyFeedTone(event.summary, event.type),
  };
}

function toBotFeedItem(message: BotMessage): FeedItem {
  return {
    id: message.id,
    label: `${message.heroName} · Turn ${message.turn}`,
    detail: message.message,
    sortKey: message.createdAt,
    tone: classifyFeedTone(message.message, "bot"),
  };
}

function classifyFeedTone(
  text: string,
  source?: string,
): FeedItem["tone"] | undefined {
  const normalized = `${source ?? ""} ${text}`.toLowerCase();

  if (
    /\b(hit|slew|slay|attack|attacked|dmg|damage|combat|death)\b/.test(
      normalized,
    )
  ) {
    return "combat";
  }
  if (
    /\b(picked up|equipped|dropped|loot|treasure|used|drink|drank|consumed)\b/.test(
      normalized,
    )
  ) {
    return "loot";
  }
  if (
    /\b(stat|morale|fatigue|heal|healed|poison|shield|effect|buff|debuff)\b/.test(
      normalized,
    )
  ) {
    return "effect";
  }
  if (
    /\b(move|moved|opened a door|opened|repositions|patrols)\b/.test(normalized)
  ) {
    return "movement";
  }
  if (source === "bot") {
    return "bot";
  }
  return "system";
}
