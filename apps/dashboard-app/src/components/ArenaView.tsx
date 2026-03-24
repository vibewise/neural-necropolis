import {
  lazy,
  Suspense,
  useCallback,
  useEffect,
  useMemo,
  useState,
} from "react";
import type {
  ArenaBotConfig,
  ArenaSummary,
  ArenaBotStanding,
  ArenaMatchSnapshot,
  DuelHeroTokenStats,
  DuelResult,
  CreateArenaRequest,
  AddMatchRequest,
} from "../api";
import { deriveSelectedBoardSummary } from "../dashboardModel";
import { useDashboardStore } from "../dashboardStore";
import { useDashboardQueries } from "../hooks/useDashboardQueries";
import { useArena } from "../hooks/useArena";
import { ARCHETYPES, type Archetype } from "../archetypes";
import { useHeroBuildStore, type HeroBuild } from "../heroBuildStore";
import { FeedPanel } from "./FeedPanel";

const LazyMapPanel = lazy(async () => {
  const module = await import("./MapPanel");
  return { default: module.MapPanel };
});

const LazyHostedAgentsPanel = lazy(async () => {
  const module = await import("./HostedAgentsPanel");
  return { default: module.HostedAgentsPanel };
});

// ── Known providers & popular models ──

const KNOWN_PROVIDERS = [
  { value: "openai", label: "OpenAI" },
  { value: "groq", label: "Groq" },
  { value: "together", label: "Together AI" },
  { value: "anthropic", label: "Anthropic" },
  { value: "google", label: "Google" },
  { value: "mistral", label: "Mistral" },
  { value: "deepseek", label: "DeepSeek" },
  { value: "fireworks", label: "Fireworks AI" },
];

const POPULAR_MODELS: Record<
  string,
  Array<{ value: string; label: string }>
> = {
  openai: [
    { value: "gpt-4o", label: "GPT-4o" },
    { value: "gpt-4o-mini", label: "GPT-4o Mini" },
    { value: "o3-mini", label: "o3-mini" },
    { value: "gpt-4-turbo", label: "GPT-4 Turbo" },
  ],
  groq: [
    { value: "llama-3.3-70b-versatile", label: "Llama 3.3 70B" },
    { value: "qwen-qwq-32b", label: "QwQ 32B" },
    { value: "gemma2-9b-it", label: "Gemma 2 9B" },
    { value: "mixtral-8x7b-32768", label: "Mixtral 8x7B" },
  ],
  together: [
    {
      value: "meta-llama/Llama-3.3-70B-Instruct-Turbo",
      label: "Llama 3.3 70B",
    },
    { value: "Qwen/Qwen2.5-72B-Instruct-Turbo", label: "Qwen 2.5 72B" },
    {
      value: "mistralai/Mixtral-8x22B-Instruct-v0.1",
      label: "Mixtral 8x22B",
    },
  ],
  anthropic: [
    { value: "claude-sonnet-4-20250514", label: "Claude Sonnet 4" },
    { value: "claude-3-5-haiku-20241022", label: "Claude 3.5 Haiku" },
  ],
  google: [
    { value: "gemini-2.0-flash", label: "Gemini 2.0 Flash" },
    { value: "gemini-1.5-pro", label: "Gemini 1.5 Pro" },
  ],
  mistral: [
    { value: "mistral-large-latest", label: "Mistral Large" },
    { value: "mistral-small-latest", label: "Mistral Small" },
  ],
  deepseek: [
    { value: "deepseek-chat", label: "DeepSeek Chat (V3)" },
    { value: "deepseek-reasoner", label: "DeepSeek Reasoner (R1)" },
  ],
  fireworks: [
    {
      value: "accounts/fireworks/models/llama-v3p3-70b-instruct",
      label: "Llama 3.3 70B",
    },
  ],
};

const KNOWN_STRATEGIES = [
  { value: "berserker", label: "Berserker" },
  { value: "explorer", label: "Explorer" },
  { value: "treasure-hunter", label: "Treasure Hunter" },
];

const PROMPT_STYLE_OPTIONS = [
  {
    value: "smart",
    label: "Smart",
    description:
      "Adds anti-loop guidance and pushes the bot to act on known information.",
  },
  {
    value: "naive",
    label: "Naive",
    description:
      "Keeps a looser baseline prompt so you can compare behavior against smart mode.",
  },
];

function archetypeToBot(arch: Archetype, index: number): ArenaBotConfig {
  return {
    label: `${arch.label} ${String.fromCharCode(65 + index)}`,
    provider: "openai",
    model: "gpt-4o",
    strategy: arch.overrides.strategy ?? "balanced",
    promptStyle: "smart",
    temperature: 0.7,
    maxOutputTokens: 300,
  };
}

// ── ArenaView — the main workspace ──

type ArenaViewProps = {
  apiBase: string;
  mode: "workshop" | "arena" | "overview";
};

type ArenaFocusTarget =
  | { kind: "arena" }
  | { kind: "match"; matchId: string }
  | { kind: "duel"; matchId: string; duelIndex: number }
  | { kind: "bot"; matchId: string; duelIndex: number; botIndex: number };

export function ArenaView({ apiBase, mode }: ArenaViewProps) {
  const arena = useArena({ apiBase });
  const selectedBoardId = useDashboardStore((state) => state.selectedBoardId);
  const setSelectedBoardId = useDashboardStore(
    (state) => state.setSelectedBoardId,
  );
  const streamLogs = useDashboardStore((state) => state.streamLogs);
  const dashboard = useDashboardQueries({ apiBase, boardId: selectedBoardId });

  const handleCreate = useCallback(
    (req: CreateArenaRequest) => {
      arena.createArenaMutation.mutate(req);
    },
    [arena.createArenaMutation],
  );

  const handleAddMatch = useCallback(
    (req: AddMatchRequest) => {
      arena.addMatchMutation.mutate(req);
    },
    [arena.addMatchMutation],
  );

  const handleStart = useCallback(() => {
    arena.startArenaMutation.mutate();
  }, [arena.startArenaMutation]);

  const detail = arena.arenaDetail;
  const isBusy =
    arena.createArenaMutation.isPending ||
    arena.addMatchMutation.isPending ||
    arena.startArenaMutation.isPending;
  const [isMapFullscreen, setIsMapFullscreen] = useState(false);
  const [focusTarget, setFocusTarget] = useState<ArenaFocusTarget>({
    kind: "arena",
  });
  const boards = dashboard.boardsQuery.data?.boards ?? [];
  const snapshot = dashboard.snapshotQuery.data ?? null;
  const arenaBoardIds = useMemo(() => {
    if (!detail) {
      return [] as string[];
    }

    const ids: string[] = [];
    for (const match of detail.matches) {
      for (const duel of match.duels) {
        if (duel.boardId) {
          ids.push(duel.boardId);
        }
      }
    }
    return ids;
  }, [detail]);
  const availableBoardIds = useMemo(
    () => new Set(boards.map((board) => board.boardId)),
    [boards],
  );
  const availableArenaBoardIds = useMemo(
    () => arenaBoardIds.filter((boardId) => availableBoardIds.has(boardId)),
    [arenaBoardIds, availableBoardIds],
  );
  const focusBoardId = useMemo(() => {
    for (let i = availableArenaBoardIds.length - 1; i >= 0; i--) {
      if (availableArenaBoardIds[i]) {
        return availableArenaBoardIds[i];
      }
    }
    return null;
  }, [availableArenaBoardIds]);
  const visibleBoards = useMemo(() => {
    if (!detail) {
      return boards;
    }
    if (availableArenaBoardIds.length === 0) {
      return [] as typeof boards;
    }
    const allowed = new Set(availableArenaBoardIds);
    return boards.filter((board) => allowed.has(board.boardId));
  }, [availableArenaBoardIds, boards, detail]);
  const selectedBoardStillVisible = useMemo(
    () =>
      selectedBoardId
        ? visibleBoards.some((board) => board.boardId === selectedBoardId)
        : false,
    [selectedBoardId, visibleBoards],
  );

  useEffect(() => {
    if (mode !== "overview") {
      return;
    }
    if (!detail) {
      return;
    }
    if (selectedBoardId && !selectedBoardStillVisible) {
      setSelectedBoardId(focusBoardId ?? null);
      return;
    }
    if (!focusBoardId && selectedBoardId && !selectedBoardStillVisible) {
      setSelectedBoardId(null);
    }
  }, [
    detail,
    focusBoardId,
    mode,
    selectedBoardId,
    selectedBoardStillVisible,
    setSelectedBoardId,
  ]);

  const selectedBoard = useMemo(
    () => deriveSelectedBoardSummary(boards, selectedBoardId, snapshot),
    [boards, selectedBoardId, snapshot],
  );
  const selectedMatch = useMemo(() => {
    if (!detail || focusTarget.kind === "arena") {
      return null;
    }
    return (
      detail.matches.find((match) => match.id === focusTarget.matchId) ?? null
    );
  }, [detail, focusTarget]);
  const selectedDuel = useMemo(() => {
    if (!selectedMatch) {
      return null;
    }
    if (focusTarget.kind !== "duel" && focusTarget.kind !== "bot") {
      return null;
    }
    return (
      selectedMatch.duels.find(
        (duel) => duel.duelIndex === focusTarget.duelIndex,
      ) ?? null
    );
  }, [focusTarget, selectedMatch]);
  const selectedBot = useMemo(() => {
    if (!detail || focusTarget.kind !== "bot") {
      return null;
    }
    return detail.bots[focusTarget.botIndex] ?? null;
  }, [detail, focusTarget]);
  const selectedStanding = useMemo(() => {
    if (!detail || focusTarget.kind !== "bot") {
      return null;
    }
    return (
      detail.standings.find(
        (standing) => standing.botIndex === focusTarget.botIndex,
      ) ?? null
    );
  }, [detail, focusTarget]);
  const focusedStreamLogs = useMemo(
    () => filterStreamLogsForFocus(streamLogs, detail, focusTarget),
    [detail, focusTarget, streamLogs],
  );

  const setFocusedBoardIfAvailable = useCallback(
    (boardId: string | null | undefined) => {
      if (!boardId) {
        return;
      }
      if (availableBoardIds.has(boardId)) {
        setSelectedBoardId(boardId);
      }
    },
    [availableBoardIds, setSelectedBoardId],
  );

  const focusArena = useCallback(() => {
    setFocusTarget({ kind: "arena" });
  }, []);

  const focusMatch = useCallback((matchId: string) => {
    setFocusTarget({ kind: "match", matchId });
  }, []);

  const focusDuel = useCallback(
    (matchId: string, duel: DuelResult) => {
      if (mode !== "overview" || duel.status === "running") {
        setFocusedBoardIfAvailable(duel.boardId);
      }
      setFocusTarget({ kind: "duel", matchId, duelIndex: duel.duelIndex });
    },
    [mode, setFocusedBoardIfAvailable],
  );

  const focusBot = useCallback(
    (botIndex: number, matchId?: string, duelIndex?: number) => {
      if (matchId != null && duelIndex != null) {
        const duel = detail?.matches
          .find((match) => match.id === matchId)
          ?.duels.find((entry) => entry.duelIndex === duelIndex);
        if (mode !== "overview" || duel?.status === "running") {
          setFocusedBoardIfAvailable(duel?.boardId);
        }
        setFocusTarget({ kind: "bot", matchId, duelIndex, botIndex });
        return;
      }

      const latestDuel = detail?.matches
        .flatMap((match) =>
          match.duels.map((duel) => ({ matchId: match.id, duel })),
        )
        .reverse()
        .find(({ duel }) => duel.botPositions.includes(botIndex));

      if (mode !== "overview" || latestDuel?.duel.status === "running") {
        setFocusedBoardIfAvailable(latestDuel?.duel.boardId);
      }
      setFocusTarget({
        kind: "bot",
        matchId: latestDuel?.matchId ?? detail?.matches[0]?.id ?? "",
        duelIndex: latestDuel?.duel.duelIndex ?? 0,
        botIndex,
      });
    },
    [detail, mode, setFocusedBoardIfAvailable],
  );

  useEffect(() => {
    if (!detail) {
      setFocusTarget({ kind: "arena" });
      return;
    }

    if (focusTarget.kind === "arena") {
      return;
    }

    const match = detail.matches.find(
      (entry) => entry.id === focusTarget.matchId,
    );
    if (!match) {
      setFocusTarget({ kind: "arena" });
      return;
    }

    if (focusTarget.kind === "match") {
      return;
    }

    const duel = match.duels.find(
      (entry) => entry.duelIndex === focusTarget.duelIndex,
    );
    if (!duel) {
      setFocusTarget({ kind: "match", matchId: match.id });
      return;
    }

    if (
      focusTarget.kind === "bot" &&
      !duel.botPositions.includes(focusTarget.botIndex)
    ) {
      setFocusTarget({
        kind: "duel",
        matchId: match.id,
        duelIndex: duel.duelIndex,
      });
    }
  }, [detail, focusTarget]);

  useEffect(() => {
    if (!isMapFullscreen) {
      return;
    }

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setIsMapFullscreen(false);
      }
    };

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [isMapFullscreen]);
  const showArenaToolbar = mode !== "workshop";

  return (
    <div className="arena-view">
      {showArenaToolbar && (
        <div className="arena-toolbar">
          <div className="arena-toolbar-left">
            <ArenaDropdown
              arenas={arena.arenas}
              selectedId={arena.selectedArenaId}
              onSelect={arena.setSelectedArenaId}
            />
            {detail && (
              <div className="arena-toolbar-status">
                <span className={`arena-status-badge ${detail.status}`}>
                  {detail.status}
                </span>
                <span className="arena-toolbar-meta">
                  {detail.bots.length} bots &middot; {detail.matches.length}{" "}
                  matches
                </span>
              </div>
            )}
          </div>
          <div className="arena-toolbar-right">
            {detail && detail.status === "pending" && (
              <button
                type="button"
                className="arena-toggle-btn start"
                disabled={
                  !arena.adminToken || isBusy || detail.matches.length === 0
                }
                onClick={handleStart}
              >
                ▶ Start Arena
              </button>
            )}
            {detail && detail.status === "running" && (
              <span className="arena-running-indicator">⚡ Arena Running</span>
            )}
            {detail && detail.status === "complete" && (
              <span className="arena-complete-indicator">✓ Complete</span>
            )}
          </div>
        </div>
      )}

      {/* ── Main content ── */}
      {mode === "workshop" ? (
        <section className="panel workspace-stage-panel">
          <div className="workspace-stage-head">
            <h2>Agent Workshop</h2>
            <p>
              Build, save, and review your agents here. Running happens from the
              Arena page after you choose a roster and bind models.
            </p>
          </div>
          <Suspense
            fallback={
              <div className="empty-state" style={{ padding: 16 }}>
                Loading hosted-agent builder&hellip;
              </div>
            }
          >
            <LazyHostedAgentsPanel apiBase={apiBase} />
          </Suspense>
        </section>
      ) : mode === "arena" ? (
        <div className="arena-setup-surface">
          <ArenaCreator
            adminToken={arena.adminToken}
            onSubmit={handleCreate}
            busy={isBusy}
          />

          {(detail?.status === "pending" ||
            (detail && detail.standings.length > 0)) && (
            <div className="arena-setup-secondary">
              {detail && detail.status === "pending" && (
                <MatchConfigurator
                  adminToken={arena.adminToken}
                  onAddMatch={handleAddMatch}
                  busy={isBusy}
                />
              )}

              {detail && detail.standings.length > 0 && (
                <StandingsTable standings={detail.standings} />
              )}
            </div>
          )}

          {detail && detail.matches.length > 0 && (
            <div className="av-card">
              <h3>Matches</h3>
              <div className="av-card-body">
                <MatchList matches={detail.matches} />
              </div>
            </div>
          )}
        </div>
      ) : (
        <div
          className={`arena-overview${isMapFullscreen ? " map-expanded" : ""}`}
        >
          <section className="panel arena-overview-trackbar">
            <div className="arena-overview-trackbar-head">
              <div>
                <h2>Matches & Duels</h2>
                <p>
                  Select a match, duel, or bot to drive the detail drawer below.
                  Running duels can also take over the map focus.
                </p>
              </div>
              <div className="arena-overview-trackbar-meta">
                {detail ? (
                  <>
                    <span>{detail.matches.length} matches</span>
                    <span>{arenaBoardIds.length} live boards</span>
                  </>
                ) : (
                  <span>No arena selected</span>
                )}
              </div>
            </div>
            {detail && detail.matches.length > 0 ? (
              <ArenaOverviewTrack
                matches={detail.matches}
                focusTarget={focusTarget}
                onSelectMatch={focusMatch}
                onSelectDuel={focusDuel}
              />
            ) : (
              <div className="empty-state">
                Select an arena with matches to inspect duel progress.
              </div>
            )}
          </section>

          <section className="middle arena-middle">
            <aside className="panel rail">
              <div className="rail-stack">
                <section className="card rail-card">
                  <div className="rail-card-title-row">
                    <h2>Selected Arena</h2>
                    <button
                      type="button"
                      className="focus-link-btn"
                      onClick={focusArena}
                    >
                      Focus
                    </button>
                  </div>
                  <div className="rail-body">
                    {detail ? (
                      <>
                        <div className="snapshot-row">
                          <span className="snapshot-label">Arena</span>
                          <span className="snapshot-value">{detail.name}</span>
                        </div>
                        <div className="snapshot-row">
                          <span className="snapshot-label">Status</span>
                          <span className="snapshot-value">
                            {detail.status}
                          </span>
                        </div>
                        <div className="snapshot-row">
                          <span className="snapshot-label">Bots</span>
                          <span className="snapshot-value">
                            {detail.bots.length} configured
                          </span>
                        </div>
                        <div className="snapshot-row">
                          <span className="snapshot-label">Matches</span>
                          <span className="snapshot-value">
                            {detail.matches.length} total
                          </span>
                        </div>
                        <div className="snapshot-row">
                          <span className="snapshot-label">Players / Duel</span>
                          <span className="snapshot-value">
                            {detail.playersPerDuel}
                          </span>
                        </div>
                        <div className="snapshot-row">
                          <span className="snapshot-label">Board Focus</span>
                          <span className="snapshot-value">
                            {selectedBoard?.boardName ?? "Arena board"}
                          </span>
                        </div>
                      </>
                    ) : (
                      <div className="empty-state">
                        Select an arena to review its status and matches.
                      </div>
                    )}
                  </div>
                </section>

                <section className="card rail-card">
                  <h2>Standings</h2>
                  <div className="rail-body">
                    {detail && detail.standings.length > 0 ? (
                      <CompactStandings
                        standings={detail.standings}
                        selectedBotIndex={
                          focusTarget.kind === "bot"
                            ? focusTarget.botIndex
                            : null
                        }
                        onSelectBot={(botIndex) => focusBot(botIndex)}
                      />
                    ) : (
                      <div className="empty-state">No completed duels yet.</div>
                    )}
                  </div>
                </section>
              </div>
            </aside>

            {isMapFullscreen && (
              <div
                className="map-fullscreen-backdrop"
                onClick={() => setIsMapFullscreen(false)}
              />
            )}

            <section
              className={`panel map-panel${isMapFullscreen ? " fullscreen" : ""}`}
            >
              <div className="map-panel-toolbar">
                <button
                  type="button"
                  className="map-expand-btn"
                  onClick={() => setIsMapFullscreen((value) => !value)}
                >
                  {isMapFullscreen ? "Exit fullscreen" : "Fullscreen map"}
                </button>
              </div>
              {snapshot ? (
                <Suspense
                  fallback={
                    <div
                      className="map-wrap"
                      style={{ display: "grid", placeItems: "center" }}
                    >
                      Loading map&hellip;
                    </div>
                  }
                >
                  <LazyMapPanel snapshot={snapshot} />
                </Suspense>
              ) : (
                <div
                  className="map-wrap"
                  style={{ display: "grid", placeItems: "center" }}
                >
                  Waiting for dashboard snapshot&hellip;
                </div>
              )}
            </section>

            <aside className="panel rail">
              <div className="rail-stack">
                <section className="card rail-card">
                  <h2>Board Snapshot</h2>
                  <div className="rail-body">
                    {snapshot ? (
                      <>
                        <div className="snapshot-row">
                          <span className="snapshot-label">Board</span>
                          <span className="snapshot-value">
                            {snapshot.world.dungeonName}
                          </span>
                        </div>
                        <div className="snapshot-row">
                          <span className="snapshot-label">Slug</span>
                          <span className="snapshot-value">
                            {snapshot.boardSlug}
                          </span>
                        </div>
                        <div className="snapshot-row">
                          <span className="snapshot-label">Status</span>
                          <span className="snapshot-value">
                            {selectedBoard?.status ?? snapshot.lobby.status}
                          </span>
                        </div>
                        <div className="snapshot-row">
                          <span className="snapshot-label">Heroes</span>
                          <span className="snapshot-value">
                            {snapshot.heroes.length} attached
                          </span>
                        </div>
                        <div className="snapshot-row">
                          <span className="snapshot-label">Monsters</span>
                          <span className="snapshot-value">
                            {snapshot.monsters.length} on board
                          </span>
                        </div>
                        <div className="snapshot-row">
                          <span className="snapshot-label">Turn</span>
                          <span className="snapshot-value">
                            {snapshot.turnState.turn} ·{" "}
                            {snapshot.turnState.phase}
                          </span>
                        </div>
                      </>
                    ) : (
                      <div className="empty-state">
                        No active board snapshot.
                      </div>
                    )}
                  </div>
                </section>

                <section className="card rail-card">
                  <h2>Live Feed</h2>
                  <div className="rail-body">
                    <FeedPanel
                      snapshot={snapshot}
                      streamLogs={focusedStreamLogs}
                      rail
                    />
                  </div>
                </section>
              </div>
            </aside>
          </section>

          <FocusDetailPanel
            detail={detail}
            snapshot={snapshot}
            selectedBoard={selectedBoard}
            visibleBoardIds={availableBoardIds}
            focusTarget={focusTarget}
            selectedMatch={selectedMatch}
            selectedDuel={selectedDuel}
            selectedBot={selectedBot}
            selectedStanding={selectedStanding}
            onFocusArena={focusArena}
            onFocusMatch={focusMatch}
            onFocusDuel={focusDuel}
            onFocusBot={focusBot}
          />
        </div>
      )}
    </div>
  );
}

function filterStreamLogsForFocus(
  streamLogs: ReturnType<typeof useDashboardStore.getState>["streamLogs"],
  detail: ReturnType<typeof useArena>["arenaDetail"],
  focusTarget: ArenaFocusTarget,
) {
  if (!detail) {
    return streamLogs;
  }

  return streamLogs.filter((entry) => {
    if (entry.arenaId !== detail.id) {
      return false;
    }

    if (focusTarget.kind === "arena") {
      return true;
    }

    if (entry.matchId !== focusTarget.matchId) {
      return false;
    }

    if (focusTarget.kind === "match") {
      return true;
    }

    return entry.duelIndex === focusTarget.duelIndex;
  });
}

function CompactStandings({
  standings,
  selectedBotIndex,
  onSelectBot,
}: {
  standings: ArenaBotStanding[];
  selectedBotIndex: number | null;
  onSelectBot: (botIndex: number) => void;
}) {
  const sorted = [...standings].sort(
    (a, b) => b.wins - a.wins || b.totalScore - a.totalScore,
  );

  return (
    <>
      {sorted.map((standing) => (
        <button
          key={standing.botIndex}
          type="button"
          className={`leaderboard-row leaderboard-button${selectedBotIndex === standing.botIndex ? " active" : ""}`}
          onClick={() => onSelectBot(standing.botIndex)}
        >
          <span className="hero-name">{standing.label}</span>
          <span className="hero-score">
            {standing.wins}W / {standing.totalScore}
          </span>
        </button>
      ))}
    </>
  );
}

function ArenaOverviewTrack({
  matches,
  focusTarget,
  onSelectMatch,
  onSelectDuel,
}: {
  matches: ArenaMatchSnapshot[];
  focusTarget: ArenaFocusTarget;
  onSelectMatch: (matchId: string) => void;
  onSelectDuel: (matchId: string, duel: DuelResult) => void;
}) {
  return (
    <div className="arena-track-scroll">
      {matches.map((match) => {
        const completedDuels = match.duels.filter(
          (duel) => duel.status === "complete",
        ).length;
        const isMatchActive =
          focusTarget.kind !== "arena" && focusTarget.matchId === match.id;

        return (
          <section
            key={match.id}
            className={`arena-track-card${isMatchActive ? " active" : ""}`}
          >
            <button
              type="button"
              className="arena-track-card-head"
              onClick={() => onSelectMatch(match.id)}
            >
              <span className={`arena-status-badge ${match.status}`}>
                {match.status}
              </span>
              <strong>Match {match.seed.slice(0, 8)}</strong>
              <span>
                {completedDuels}/{match.duelCount} duels
              </span>
              <span>{match.maxTurns} turns</span>
            </button>
            <div className="arena-track-duels">
              {match.duels.map((duel) => {
                const isDuelActive =
                  (focusTarget.kind === "duel" || focusTarget.kind === "bot") &&
                  focusTarget.matchId === match.id &&
                  focusTarget.duelIndex === duel.duelIndex;

                return (
                  <button
                    key={duel.duelIndex}
                    type="button"
                    className={`arena-track-duel${isDuelActive ? " active" : ""}`}
                    onClick={() => onSelectDuel(match.id, duel)}
                  >
                    <span>Duel {duel.duelIndex + 1}</span>
                    <span className={`arena-status-badge ${duel.status}`}>
                      {duel.status}
                    </span>
                  </button>
                );
              })}
            </div>
          </section>
        );
      })}
    </div>
  );
}

function FocusDetailPanel({
  detail,
  snapshot,
  selectedBoard,
  visibleBoardIds,
  focusTarget,
  selectedMatch,
  selectedDuel,
  selectedBot,
  selectedStanding,
  onFocusArena,
  onFocusMatch,
  onFocusDuel,
  onFocusBot,
}: {
  detail: ReturnType<typeof useArena>["arenaDetail"];
  snapshot:
    | ReturnType<typeof useDashboardQueries>["snapshotQuery"]["data"]
    | null;
  selectedBoard: ReturnType<typeof deriveSelectedBoardSummary>;
  visibleBoardIds: Set<string>;
  focusTarget: ArenaFocusTarget;
  selectedMatch: ArenaMatchSnapshot | null;
  selectedDuel: DuelResult | null;
  selectedBot: ArenaBotConfig | null;
  selectedStanding: ArenaBotStanding | null;
  onFocusArena: () => void;
  onFocusMatch: (matchId: string) => void;
  onFocusDuel: (matchId: string, duel: DuelResult) => void;
  onFocusBot: (botIndex: number, matchId?: string, duelIndex?: number) => void;
}) {
  const [expanded, setExpanded] = useState(true);

  useEffect(() => {
    setExpanded(true);
  }, [focusTarget]);

  const selectedDuelBoardVisible = useMemo(() => {
    if (!selectedDuel?.boardId) {
      return false;
    }
    return visibleBoardIds.has(selectedDuel.boardId);
  }, [selectedDuel, visibleBoardIds]);
  const selectedDuelLeaderboard = useMemo(
    () => selectedDuel?.leaderboard ?? [],
    [selectedDuel],
  );

  const contextLabel = useMemo(() => {
    if (!detail) {
      return "No arena selected";
    }
    if (focusTarget.kind === "arena") {
      return `Arena focus · ${detail.name}`;
    }
    if (focusTarget.kind === "match") {
      return `Match focus · ${selectedMatch?.seed.slice(0, 12) ?? focusTarget.matchId}`;
    }
    if (focusTarget.kind === "duel") {
      return `Duel focus · Match ${selectedMatch?.seed.slice(0, 8) ?? focusTarget.matchId} / Duel ${focusTarget.duelIndex + 1}`;
    }
    return `Bot focus · ${selectedBot?.label ?? `Bot ${focusTarget.botIndex + 1}`}`;
  }, [detail, focusTarget, selectedBot, selectedMatch]);

  return (
    <section
      className={`panel arena-focus-panel${expanded ? " expanded" : " collapsed"}`}
    >
      <div className="arena-focus-panel-head">
        <div>
          <h2>Focus Drawer</h2>
          <p>{contextLabel}</p>
        </div>
        <button
          type="button"
          className="focus-toggle-btn"
          onClick={() => setExpanded((value) => !value)}
        >
          {expanded ? "Hide details" : "Show details"}
        </button>
      </div>

      {expanded && (
        <div className="arena-focus-grid">
          {focusTarget.kind === "arena" && detail && (
            <>
              <section className="arena-focus-card">
                <h3>Arena Summary</h3>
                <div className="focus-stat-list">
                  <div className="snapshot-row">
                    <span className="snapshot-label">Arena</span>
                    <span className="snapshot-value">{detail.name}</span>
                  </div>
                  <div className="snapshot-row">
                    <span className="snapshot-label">Status</span>
                    <span className="snapshot-value">{detail.status}</span>
                  </div>
                  <div className="snapshot-row">
                    <span className="snapshot-label">Bots</span>
                    <span className="snapshot-value">{detail.bots.length}</span>
                  </div>
                  <div className="snapshot-row">
                    <span className="snapshot-label">Matches</span>
                    <span className="snapshot-value">
                      {detail.matches.length}
                    </span>
                  </div>
                </div>
              </section>
              <section className="arena-focus-card">
                <h3>Roster</h3>
                <div className="focus-pill-list">
                  {detail.bots.map((bot, index) => (
                    <button
                      key={`${bot.label}-${index}`}
                      type="button"
                      className="focus-pill-button"
                      onClick={() => onFocusBot(index)}
                    >
                      {bot.label}
                    </button>
                  ))}
                </div>
              </section>
            </>
          )}

          {focusTarget.kind === "match" && selectedMatch && (
            <>
              <section className="arena-focus-card">
                <h3>Match Summary</h3>
                <div className="focus-stat-list">
                  <div className="snapshot-row">
                    <span className="snapshot-label">Seed</span>
                    <span className="snapshot-value">{selectedMatch.seed}</span>
                  </div>
                  <div className="snapshot-row">
                    <span className="snapshot-label">Status</span>
                    <span className="snapshot-value">
                      {selectedMatch.status}
                    </span>
                  </div>
                  <div className="snapshot-row">
                    <span className="snapshot-label">Duels</span>
                    <span className="snapshot-value">
                      {selectedMatch.duelCount}
                    </span>
                  </div>
                  <div className="snapshot-row">
                    <span className="snapshot-label">Max Turns</span>
                    <span className="snapshot-value">
                      {selectedMatch.maxTurns}
                    </span>
                  </div>
                </div>
              </section>
              <section className="arena-focus-card">
                <h3>Duels</h3>
                <div className="focus-pill-list">
                  {selectedMatch.duels.map((duel) => (
                    <button
                      key={duel.duelIndex}
                      type="button"
                      className="focus-pill-button"
                      onClick={() => onFocusDuel(selectedMatch.id, duel)}
                    >
                      Duel {duel.duelIndex + 1} · {duel.status}
                    </button>
                  ))}
                </div>
              </section>
            </>
          )}

          {focusTarget.kind === "duel" && selectedMatch && selectedDuel && (
            <>
              <section className="arena-focus-card">
                <h3>Duel Summary</h3>
                <div className="focus-stat-list">
                  <div className="snapshot-row">
                    <span className="snapshot-label">Match</span>
                    <span className="snapshot-value">
                      {selectedMatch.seed.slice(0, 12)}
                    </span>
                  </div>
                  <div className="snapshot-row">
                    <span className="snapshot-label">Board</span>
                    <span className="snapshot-value">
                      {selectedBoard?.boardName ?? selectedDuel.boardId}
                    </span>
                  </div>
                  <div className="snapshot-row">
                    <span className="snapshot-label">Status</span>
                    <span className="snapshot-value">
                      {selectedDuel.status}
                    </span>
                  </div>
                  <div className="snapshot-row">
                    <span className="snapshot-label">Turns Reached</span>
                    <span className="snapshot-value">
                      {selectedDuel.turnReached}
                    </span>
                  </div>
                </div>
                {!selectedDuelBoardVisible && (
                  <div className="empty-state" style={{ marginTop: 12 }}>
                    This duel board is no longer in the active board set, so the
                    map stays on the current visible board while the focus
                    drawer shows duel details.
                  </div>
                )}
              </section>
              <section className="arena-focus-card">
                <h3>Participants</h3>
                <div className="focus-pill-list">
                  {selectedDuel.botPositions.map((botIndex) => (
                    <button
                      key={botIndex}
                      type="button"
                      className="focus-pill-button"
                      onClick={() =>
                        onFocusBot(
                          botIndex,
                          selectedMatch.id,
                          selectedDuel.duelIndex,
                        )
                      }
                    >
                      {detail?.bots[botIndex]?.label ?? `Bot ${botIndex + 1}`}
                    </button>
                  ))}
                </div>
              </section>
              <section className="arena-focus-card span-two">
                <h3>Leaderboard</h3>
                {selectedDuelLeaderboard.length > 0 ? (
                  <div className="focus-duel-leaderboard">
                    {selectedDuelLeaderboard.map((entry) => {
                      const botIndex = selectedDuel.botPositions.find(
                        (candidate) =>
                          detail?.bots[candidate]?.label === entry.heroName,
                      );

                      return (
                        <button
                          key={entry.heroId}
                          type="button"
                          className="focus-score-row"
                          onClick={() => {
                            if (botIndex != null) {
                              onFocusBot(
                                botIndex,
                                selectedMatch.id,
                                selectedDuel.duelIndex,
                              );
                            }
                          }}
                          disabled={botIndex == null}
                        >
                          <span>{entry.heroName}</span>
                          <span>{entry.totalScore} pts</span>
                        </button>
                      );
                    })}
                  </div>
                ) : (
                  <div className="empty-state">
                    {selectedDuel.status === "running"
                      ? "This duel is still running. Scores will appear once results are recorded."
                      : "No duel scores recorded yet."}
                  </div>
                )}
              </section>
            </>
          )}

          {focusTarget.kind === "bot" && selectedBot && (
            <>
              <section className="arena-focus-card">
                <h3>Bot Summary</h3>
                <div className="focus-stat-list">
                  <div className="snapshot-row">
                    <span className="snapshot-label">Label</span>
                    <span className="snapshot-value">{selectedBot.label}</span>
                  </div>
                  <div className="snapshot-row">
                    <span className="snapshot-label">Provider</span>
                    <span className="snapshot-value">
                      {selectedBot.provider}
                    </span>
                  </div>
                  <div className="snapshot-row">
                    <span className="snapshot-label">Model</span>
                    <span className="snapshot-value">{selectedBot.model}</span>
                  </div>
                  <div className="snapshot-row">
                    <span className="snapshot-label">Strategy</span>
                    <span className="snapshot-value">
                      {selectedBot.strategy}
                    </span>
                  </div>
                  <div className="snapshot-row">
                    <span className="snapshot-label">Prompt Style</span>
                    <span className="snapshot-value">
                      {selectedBot.promptStyle ?? "smart"}
                    </span>
                  </div>
                </div>
              </section>
              <section className="arena-focus-card">
                <h3>Performance</h3>
                {selectedStanding ? (
                  <div className="focus-stat-list">
                    <div className="snapshot-row">
                      <span className="snapshot-label">Wins</span>
                      <span className="snapshot-value">
                        {selectedStanding.wins}
                      </span>
                    </div>
                    <div className="snapshot-row">
                      <span className="snapshot-label">Duels</span>
                      <span className="snapshot-value">
                        {selectedStanding.duelsPlayed}
                      </span>
                    </div>
                    <div className="snapshot-row">
                      <span className="snapshot-label">Total Score</span>
                      <span className="snapshot-value">
                        {selectedStanding.totalScore}
                      </span>
                    </div>
                    <div className="snapshot-row">
                      <span className="snapshot-label">Avg Score</span>
                      <span className="snapshot-value">
                        {selectedStanding.duelsPlayed > 0
                          ? (
                              selectedStanding.totalScore /
                              selectedStanding.duelsPlayed
                            ).toFixed(1)
                          : "—"}
                      </span>
                    </div>
                    <div className="snapshot-row">
                      <span className="snapshot-label">Prompt Tokens</span>
                      <span className="snapshot-value">
                        {(
                          selectedStanding.totalPromptTokens ?? 0
                        ).toLocaleString()}
                      </span>
                    </div>
                    <div className="snapshot-row">
                      <span className="snapshot-label">Completion Tokens</span>
                      <span className="snapshot-value">
                        {(
                          selectedStanding.totalCompletionTokens ?? 0
                        ).toLocaleString()}
                      </span>
                    </div>
                    <div className="snapshot-row">
                      <span className="snapshot-label">LLM Calls</span>
                      <span className="snapshot-value">
                        {selectedStanding.totalLlmCalls ?? 0}
                      </span>
                    </div>
                  </div>
                ) : (
                  <div className="empty-state">No standings available yet.</div>
                )}
              </section>
              <section className="arena-focus-card span-two">
                <h3>Context</h3>
                <div className="focus-context-row">
                  <button
                    type="button"
                    className="focus-pill-button"
                    onClick={onFocusArena}
                  >
                    Arena
                  </button>
                  {selectedMatch && (
                    <button
                      type="button"
                      className="focus-pill-button"
                      onClick={() => onFocusMatch(selectedMatch.id)}
                    >
                      Match {selectedMatch.seed.slice(0, 8)}
                    </button>
                  )}
                  {selectedMatch && selectedDuel && (
                    <button
                      type="button"
                      className="focus-pill-button"
                      onClick={() =>
                        onFocusDuel(selectedMatch.id, selectedDuel)
                      }
                    >
                      Duel {selectedDuel.duelIndex + 1}
                    </button>
                  )}
                  {snapshot && (
                    <span className="focus-context-note">
                      Current board turn {snapshot.turnState.turn} ·{" "}
                      {snapshot.turnState.phase}
                    </span>
                  )}
                </div>
              </section>
            </>
          )}

          {!detail && (
            <section className="arena-focus-card span-two">
              <h3>Waiting for Arena</h3>
              <div className="empty-state">
                Select an arena to inspect match, duel, and bot focus here.
              </div>
            </section>
          )}
        </div>
      )}
    </section>
  );
}

// ── Arena dropdown selector ──

function ArenaDropdown({
  arenas,
  selectedId,
  onSelect,
}: {
  arenas: ArenaSummary[];
  selectedId: string | null;
  onSelect: (id: string | null) => void;
}) {
  return (
    <select
      className="arena-dropdown"
      value={selectedId ?? ""}
      onChange={(e) => onSelect(e.target.value || null)}
    >
      <option value="">— Select Arena —</option>
      {arenas.map((a) => (
        <option key={a.id} value={a.id}>
          {a.name} ({a.status}) — {a.botCount} bots, {a.matchCount} matches
        </option>
      ))}
    </select>
  );
}

// ── Arena creator ──

function ArenaCreator({
  adminToken,
  onSubmit,
  busy,
}: {
  adminToken: string;
  onSubmit: (req: CreateArenaRequest) => void;
  busy: boolean;
}) {
  const savedBuilds = useHeroBuildStore((s) => s.builds);
  const [name, setName] = useState("LLM Arena");
  const [playersPerDuel, setPlayersPerDuel] = useState(2);
  const [bots, setBots] = useState<
    Array<ArenaBotConfig & { archetypeId: string }>
  >([
    { ...archetypeToBot(ARCHETYPES[0], 0), archetypeId: ARCHETYPES[0].id },
    { ...archetypeToBot(ARCHETYPES[1], 1), archetypeId: ARCHETYPES[1].id },
  ]);
  const [expandedBot, setExpandedBot] = useState<number | null>(null);

  const setArchetype = useCallback((index: number, arch: Archetype) => {
    setBots((prev) => {
      const next = [...prev];
      next[index] = {
        ...archetypeToBot(arch, index),
        label: prev[index].label,
        provider: prev[index].provider,
        model: prev[index].model,
        temperature: prev[index].temperature,
        maxOutputTokens: prev[index].maxOutputTokens,
        promptStyle: prev[index].promptStyle,
        reasoningEffort: prev[index].reasoningEffort,
        archetypeId: arch.id,
      };
      return next;
    });
  }, []);

  const updateBot = useCallback(
    (index: number, field: keyof ArenaBotConfig, value: string | number) => {
      setBots((prev) => {
        const next = [...prev];
        next[index] = { ...next[index], [field]: value };
        return next;
      });
    },
    [],
  );

  const addBot = useCallback(() => {
    const archIdx = bots.length % ARCHETYPES.length;
    const arch = ARCHETYPES[archIdx];
    setBots((prev) => [
      ...prev,
      { ...archetypeToBot(arch, prev.length), archetypeId: arch.id },
    ]);
  }, [bots.length]);

  const addSavedBot = useCallback((build: HeroBuild) => {
    const arch = ARCHETYPES.find((a) => a.id === build.archetypeId);
    setBots((prev) => [
      ...prev,
      {
        label: build.name,
        provider: "openai",
        model: "gpt-4o",
        strategy:
          build.draft.strategy || arch?.overrides.strategy || "balanced",
        promptStyle: "smart",
        archetypeId: build.archetypeId ?? (arch?.id || ARCHETYPES[0].id),
      },
    ]);
  }, []);

  const removeBot = useCallback((index: number) => {
    setBots((prev) => prev.filter((_, i) => i !== index));
  }, []);

  const handleSubmit = useCallback(() => {
    if (!name.trim() || bots.length < 2) return;
    const stripped = bots.map(({ archetypeId: _, ...rest }) => rest);
    onSubmit({
      name: name.trim(),
      bots: stripped,
      playersPerDuel: Math.max(2, Math.min(playersPerDuel, stripped.length)),
    });
  }, [name, bots, onSubmit, playersPerDuel]);

  return (
    <div className="av-creator">
      <div className="av-creator-top">
        <div className="av-creator-head">
          <h2>Create Arena</h2>
          <p>Choose the roster, bind models, then start the arena.</p>
        </div>
        <div className="av-creator-actions av-creator-actions-top">
          <button
            type="button"
            className="av-create-btn"
            disabled={
              !adminToken ||
              busy ||
              bots.length < 2 ||
              !name.trim() ||
              playersPerDuel < 2
            }
            onClick={handleSubmit}
          >
            Create Arena
          </button>
          {!adminToken && (
            <span className="av-hint">
              Save an admin token in Settings to create arenas.
            </span>
          )}
        </div>
      </div>

      <div className="av-setup-grid">
        <label className="av-field-lg">
          <span>Arena Name</span>
          <input
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="LLM Arena"
          />
        </label>
        <label className="av-field-lg">
          <span>Players Per Duel</span>
          <input
            type="number"
            min={2}
            max={Math.max(2, bots.length)}
            value={Math.min(playersPerDuel, Math.max(2, bots.length))}
            onChange={(e) => setPlayersPerDuel(Number(e.target.value || 2))}
          />
        </label>
        <div className="av-inline-note av-inline-note-full">
          Each duel can run a subset of the roster. Use the full roster size to
          make every configured agent participate at once.
        </div>
      </div>

      <div className="av-bots-section">
        <div className="av-bots-head">
          <span>Agents ({bots.length})</span>
          <div className="av-bots-head-actions">
            {savedBuilds.length > 0 && (
              <select
                className="av-saved-select"
                value=""
                disabled={bots.length >= 8}
                onChange={(e) => {
                  const build = savedBuilds.find(
                    (b) => b.id === e.target.value,
                  );
                  if (build) addSavedBot(build);
                }}
              >
                <option value="">+ From Library</option>
                {savedBuilds.map((b) => (
                  <option key={b.id} value={b.id}>
                    {b.name}
                    {b.archetypeId ? ` (${b.archetypeId})` : ""}
                  </option>
                ))}
              </select>
            )}
            <button
              type="button"
              className="av-btn-add"
              onClick={addBot}
              disabled={bots.length >= 8}
            >
              + Add Agent
            </button>
          </div>
        </div>

        <div className="av-inline-note av-inline-note-full">
          Provider and model are configured per agent. You can mix providers in
          one arena, for example OpenAI on one bot and Groq with Llama on the
          other, as long as the matching API keys are available to the engine.
          Prompt Style lets you compare a smarter anti-loop prompt against a
          naive baseline on the same roster.
        </div>

        <div className="av-bots-grid">
          {bots.map((bot, i) => {
            const activeArch = ARCHETYPES.find((a) => a.id === bot.archetypeId);
            const isExpanded = expandedBot === i;
            return (
              <div key={i} className="av-bot-card">
                <div className="av-bot-card-top">
                  <input
                    type="text"
                    className="av-bot-name"
                    value={bot.label}
                    onChange={(e) => updateBot(i, "label", e.target.value)}
                    placeholder={`Agent ${String.fromCharCode(65 + i)}`}
                  />
                  {bots.length > 2 && (
                    <button
                      type="button"
                      className="av-bot-remove"
                      onClick={() => removeBot(i)}
                      title="Remove agent"
                    >
                      ×
                    </button>
                  )}
                </div>

                <div className="av-archetype-row">
                  {ARCHETYPES.map((arch) => (
                    <button
                      key={arch.id}
                      type="button"
                      className={`av-archetype-btn${bot.archetypeId === arch.id ? " active" : ""}`}
                      onClick={() => setArchetype(i, arch)}
                      title={arch.description}
                    >
                      <span className="av-arch-icon">{arch.icon}</span>
                      <span className="av-arch-label">{arch.label}</span>
                    </button>
                  ))}
                </div>

                {activeArch && (
                  <div className="av-bot-archetype-desc">
                    {activeArch.description}
                  </div>
                )}

                <button
                  type="button"
                  className="av-bot-advanced-toggle"
                  onClick={() => setExpandedBot(isExpanded ? null : i)}
                >
                  {isExpanded ? "▼ Hide" : "▶ Provider / Model"}
                </button>

                {isExpanded && (
                  <div className="av-bot-advanced">
                    <label className="av-field-sm">
                      <span>Provider</span>
                      <select
                        value={bot.provider}
                        onChange={(e) => {
                          updateBot(i, "provider", e.target.value);
                          const models = POPULAR_MODELS[e.target.value];
                          if (models?.[0]) {
                            updateBot(i, "model", models[0].value);
                          }
                        }}
                      >
                        {KNOWN_PROVIDERS.map((p) => (
                          <option key={p.value} value={p.value}>
                            {p.label}
                          </option>
                        ))}
                      </select>
                    </label>
                    <label className="av-field-sm">
                      <span>Model</span>
                      <select
                        value={
                          POPULAR_MODELS[bot.provider]?.some(
                            (m) => m.value === bot.model,
                          )
                            ? bot.model
                            : "__custom"
                        }
                        onChange={(e) => {
                          if (e.target.value !== "__custom") {
                            updateBot(i, "model", e.target.value);
                          }
                        }}
                      >
                        {(POPULAR_MODELS[bot.provider] ?? []).map((m) => (
                          <option key={m.value} value={m.value}>
                            {m.label}
                          </option>
                        ))}
                        <option value="__custom">Custom...</option>
                      </select>
                    </label>
                    <label className="av-field-sm">
                      <span>Prompt Style</span>
                      <select
                        value={bot.promptStyle ?? "smart"}
                        onChange={(e) =>
                          updateBot(i, "promptStyle", e.target.value)
                        }
                      >
                        {PROMPT_STYLE_OPTIONS.map((option) => (
                          <option key={option.value} value={option.value}>
                            {option.label}
                          </option>
                        ))}
                      </select>
                    </label>
                    <label className="av-field-sm">
                      <span>Temperature</span>
                      <input
                        type="number"
                        min={0}
                        max={2}
                        step={0.1}
                        value={bot.temperature ?? 0.7}
                        onChange={(e) =>
                          updateBot(i, "temperature", Number(e.target.value))
                        }
                      />
                    </label>
                    <label className="av-field-sm">
                      <span>Max Output Tokens</span>
                      <input
                        type="number"
                        min={32}
                        max={4096}
                        step={32}
                        value={bot.maxOutputTokens ?? 300}
                        onChange={(e) =>
                          updateBot(
                            i,
                            "maxOutputTokens",
                            Number(e.target.value),
                          )
                        }
                      />
                    </label>
                    <label className="av-field-sm">
                      <span>Reasoning Effort</span>
                      <select
                        value={bot.reasoningEffort ?? ""}
                        onChange={(e) =>
                          updateBot(
                            i,
                            "reasoningEffort",
                            e.target.value || (undefined as unknown as string),
                          )
                        }
                      >
                        <option value="">Default</option>
                        <option value="low">Low</option>
                        <option value="medium">Medium</option>
                        <option value="high">High</option>
                      </select>
                    </label>
                    <div className="av-inline-note av-inline-note-full">
                      {
                        PROMPT_STYLE_OPTIONS.find(
                          (option) =>
                            option.value === (bot.promptStyle ?? "smart"),
                        )?.description
                      }
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

// ── Match configurator ──

function MatchConfigurator({
  adminToken,
  onAddMatch,
  busy,
}: {
  adminToken: string;
  onAddMatch: (req: AddMatchRequest) => void;
  busy: boolean;
}) {
  const [duelCount, setDuelCount] = useState("10");
  const [maxTurns, setMaxTurns] = useState("100");

  const parsedDuelCount = Number.parseInt(duelCount, 10);
  const parsedMaxTurns = Number.parseInt(maxTurns, 10);
  const duelCountValid =
    Number.isFinite(parsedDuelCount) &&
    parsedDuelCount >= 2 &&
    parsedDuelCount % 2 === 0;
  const maxTurnsValid = Number.isFinite(parsedMaxTurns) && parsedMaxTurns >= 10;

  const handleAdd = useCallback(() => {
    if (!duelCountValid || !maxTurnsValid) return;
    onAddMatch({ duelCount: parsedDuelCount, maxTurns: parsedMaxTurns });
  }, [
    duelCountValid,
    maxTurnsValid,
    onAddMatch,
    parsedDuelCount,
    parsedMaxTurns,
  ]);

  return (
    <div className="av-card">
      <h3>Add Match</h3>
      <div className="av-card-body">
        <div className="av-field-row">
          <label className="av-field">
            <span>Duels (even)</span>
            <input
              type="number"
              min={2}
              step={2}
              value={duelCount}
              onChange={(e) => setDuelCount(e.target.value)}
            />
          </label>
          <label className="av-field">
            <span>Max Turns</span>
            <input
              type="number"
              min={10}
              value={maxTurns}
              onChange={(e) => setMaxTurns(e.target.value)}
            />
          </label>
        </div>
        <button
          type="button"
          disabled={!adminToken || busy || !duelCountValid || !maxTurnsValid}
          onClick={handleAdd}
        >
          + Add Match
        </button>
        {duelCount !== "" && !duelCountValid && (
          <div className="av-hint">
            Duel count must be an even number of at least 2.
          </div>
        )}
        {maxTurns !== "" && !maxTurnsValid && (
          <div className="av-hint">Max turns must be at least 10.</div>
        )}
      </div>
    </div>
  );
}

// ── Standings table ──

function StandingsTable({ standings }: { standings: ArenaBotStanding[] }) {
  const sorted = [...standings].sort(
    (a, b) => b.wins - a.wins || b.totalScore - a.totalScore,
  );

  return (
    <div className="av-card">
      <h3>Standings</h3>
      <div className="av-card-body">
        <table className="arena-table">
          <thead>
            <tr>
              <th>#</th>
              <th>Bot</th>
              <th>Provider / Model</th>
              <th>W</th>
              <th>Duels</th>
              <th>Win %</th>
              <th>Total</th>
              <th>Avg</th>
              <th>Prompt Tok</th>
              <th>Compl Tok</th>
              <th>LLM Calls</th>
            </tr>
          </thead>
          <tbody>
            {sorted.map((s, i) => (
              <tr key={s.botIndex}>
                <td>{i + 1}</td>
                <td>
                  <strong>{s.label}</strong>
                </td>
                <td>
                  {s.provider} / {s.model}
                </td>
                <td>{s.wins}</td>
                <td>{s.duelsPlayed}</td>
                <td>
                  {s.duelsPlayed > 0
                    ? `${((s.wins / s.duelsPlayed) * 100).toFixed(1)}%`
                    : "—"}
                </td>
                <td>{s.totalScore}</td>
                <td>
                  {s.duelsPlayed > 0
                    ? (s.totalScore / s.duelsPlayed).toFixed(1)
                    : "—"}
                </td>
                <td>{(s.totalPromptTokens ?? 0).toLocaleString()}</td>
                <td>{(s.totalCompletionTokens ?? 0).toLocaleString()}</td>
                <td>{s.totalLlmCalls ?? 0}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// ── Match list ──

function MatchList({ matches }: { matches: ArenaMatchSnapshot[] }) {
  const [expandedMatch, setExpandedMatch] = useState<string | null>(null);

  return (
    <div className="av-matches">
      <h3>Matches ({matches.length})</h3>
      {matches.map((match) => {
        const completedDuels = match.duels.filter(
          (d) => d.status === "complete",
        ).length;
        const isExpanded = expandedMatch === match.id;
        return (
          <div key={match.id} className="av-match-block">
            <div
              className="av-match-header"
              onClick={() => setExpandedMatch(isExpanded ? null : match.id)}
            >
              <span className={`arena-status-badge ${match.status}`}>
                {match.status}
              </span>
              <span>
                Seed: <code>{match.seed.slice(0, 12)}...</code>
              </span>
              <span>
                {completedDuels}/{match.duelCount} duels
              </span>
              <span>{match.maxTurns} turns/duel</span>
              <span className="av-expand">{isExpanded ? "▼" : "▶"}</span>
            </div>
            {isExpanded && (
              <div className="av-duels-grid">
                {match.duels.map((duel) => (
                  <DuelCard key={duel.duelIndex} duel={duel} />
                ))}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

function DuelCard({ duel }: { duel: DuelResult }) {
  const winner =
    duel.status === "complete" && duel.leaderboard.length > 0
      ? duel.leaderboard[0]
      : null;

  return (
    <div className={`arena-duel-card ${duel.status}`}>
      <div className="duel-header">
        <span>Duel #{duel.duelIndex + 1}</span>
        <span className={`arena-status-badge ${duel.status}`}>
          {duel.status}
        </span>
      </div>
      {duel.status === "complete" && (
        <div className="duel-result">
          <span className="duel-winner">
            {winner ? `${winner.heroName}: ${winner.totalScore} pts` : "—"}
          </span>
          <span className="duel-turns">{duel.turnReached} turns</span>
        </div>
      )}
      {duel.status === "running" && (
        <div className="duel-result">
          <span className="duel-running-label">In progress...</span>
        </div>
      )}
    </div>
  );
}
