import {
  lazy,
  Suspense,
  useCallback,
  useEffect,
  useMemo,
  useState,
} from "react";

import type { DashboardResponse, AdminGameSettings } from "./api";
import { updateAdminSettings } from "./api";
import { AppHeader } from "./components/AppHeader";
import { BoardSelectorPanel } from "./components/BoardSelectorPanel";
import { CompletedBoardsPanel } from "./components/CompletedBoardsPanel";
import { ConnectionPanel } from "./components/ConnectionPanel";
import { FeedPanel } from "./components/FeedPanel";
import { GalleryPanel } from "./components/GalleryPanel";
import { HeroDetailPanel } from "./components/HeroDetailPanel";
import { LauncherPanel } from "./components/LauncherPanel";
import { OperatorControlsPanel } from "./components/OperatorControlsPanel";
import { SeedComparisonPanel } from "./components/SeedComparisonPanel";
import {
  buildControlNotice,
  buildHeaderStatus,
  deriveSelectedBoardSummary,
  shouldApplyStreamSnapshot,
} from "./dashboardModel";
import { normalizeApiBase, useDashboardStore } from "./dashboardStore";
import { useDashboardQueries } from "./hooks/useDashboardQueries";
import { useDashboardStream } from "./hooks/useDashboardStream";

const LazyMapPanel = lazy(async () => {
  const module = await import("./components/MapPanel");
  return { default: module.MapPanel };
});

const LazyHostedAgentsPanel = lazy(async () => {
  const module = await import("./components/HostedAgentsPanel");
  return { default: module.HostedAgentsPanel };
});

type BottomTab = string;

export function App() {
  const apiBase = useDashboardStore((state) => state.apiBase);
  const setApiBase = useDashboardStore((state) => state.setApiBase);
  const selectedBoardId = useDashboardStore((state) => state.selectedBoardId);
  const setSelectedBoardId = useDashboardStore(
    (state) => state.setSelectedBoardId,
  );
  const streamState = useDashboardStore((state) => state.streamState);
  const streamLogs = useDashboardStore((state) => state.streamLogs);
  const pushStreamLog = useDashboardStore((state) => state.pushStreamLog);
  const setStreamState = useDashboardStore((state) => state.setStreamState);
  const adminToken = useDashboardStore((state) => state.adminToken);
  const [liveSnapshot, setLiveSnapshot] = useState<DashboardResponse | null>(
    null,
  );
  const [activeTab, setActiveTab] = useState<BottomTab>("hosted");
  const [paneExpanded, setPaneExpanded] = useState(false);

  const queries = useDashboardQueries({
    apiBase,
    boardId: selectedBoardId,
  });

  useEffect(() => {
    if (queries.snapshotQuery.data) {
      setLiveSnapshot(queries.snapshotQuery.data);
    }
  }, [queries.snapshotQuery.data]);

  useEffect(() => {
    const boards = queries.boardsQuery.data?.boards ?? [];
    if (!selectedBoardId) {
      return;
    }
    const stillExists = boards.some(
      (board) => board.boardId === selectedBoardId,
    );
    if (!stillExists) {
      setSelectedBoardId(null);
    }
  }, [queries.boardsQuery.data, selectedBoardId, setSelectedBoardId]);

  useDashboardStream({
    apiBase,
    onSnapshot: (snapshot) => {
      if (shouldApplyStreamSnapshot(selectedBoardId, snapshot)) {
        setLiveSnapshot(snapshot);
      }
    },
    onLog: (message) => {
      pushStreamLog(message, null);
    },
    setStreamState,
  });

  const selectedBoard = useMemo(
    () =>
      deriveSelectedBoardSummary(
        queries.boardsQuery.data?.boards ?? [],
        selectedBoardId,
        liveSnapshot,
      ),
    [queries.boardsQuery.data, selectedBoardId, liveSnapshot],
  );

  const activeSnapshot = selectedBoardId
    ? (queries.snapshotQuery.data ?? null)
    : liveSnapshot;
  const boards = queries.boardsQuery.data?.boards ?? [];
  const healthOk = Boolean(
    queries.healthQuery.data?.ok && !queries.healthQuery.isError,
  );
  const headerStatus = buildHeaderStatus(activeSnapshot);
  const controlNotice = buildControlNotice(activeSnapshot);
  const leaderboard =
    queries.leaderboardQuery.data?.leaderboard ??
    activeSnapshot?.leaderboard ??
    [];
  const seed = queries.seedQuery.data?.seed ?? activeSnapshot?.seed ?? "";

  const turnsRunning = !activeSnapshot?.gameSettings?.paused;
  const [turnsToggling, setTurnsToggling] = useState(false);
  const handleToggleTurns = useCallback(async () => {
    if (!adminToken || !activeSnapshot?.gameSettings) return;
    setTurnsToggling(true);
    try {
      const gs = activeSnapshot.gameSettings as AdminGameSettings;
      await updateAdminSettings(
        { apiBase, token: adminToken },
        { ...gs, paused: turnsRunning },
      );
    } catch {
      /* ignore — operator panel shows errors */
    } finally {
      setTurnsToggling(false);
    }
  }, [adminToken, apiBase, activeSnapshot?.gameSettings, turnsRunning]);

  const tabs: Array<[BottomTab, string, boolean?]> = [
    ["hosted", "\uD83C\uDFAE Hosted Agents"],
    ["openclaw", "\uD83D\uDC19 OpenClaw"],
    ["aibots", "\uD83E\uDD16 AI Bots", true],
    ["scripted", "\uD83D\uDCDC Scripted", true],
    ["review", "\uD83D\uDCCB Review"],
    ["settings", "\u2699 Settings & Docs"],
    ...(activeSnapshot?.heroes ?? []).map((h): [string, string] => [
      h.id,
      h.name,
    ]),
  ];

  const selectedHero = activeSnapshot?.heroes.find((h) => h.id === activeTab);

  return (
    <div className={`shell${paneExpanded ? " expanded" : " collapsed"}`}>
      {/* ─── TOP BAR ─── */}
      <section className="panel top-bar">
        <AppHeader boardStatus={headerStatus} />
        <div className="board-bar-row">
          <BoardSelectorPanel
            boards={boards}
            isLoading={queries.boardsQuery.isLoading}
            selectedBoardId={selectedBoardId}
            onSelectBoard={setSelectedBoardId}
            inline
          />
          <div className="board-bar-actions">
            {adminToken ? (
              <button
                type="button"
                className={`turn-toggle-btn ${turnsRunning ? "on" : "off"}`}
                disabled={turnsToggling}
                onClick={handleToggleTurns}
              >
                {turnsRunning ? "\u25CF Turns ON" : "\u25CB Turns OFF"}
              </button>
            ) : (
              <button
                type="button"
                className="turn-toggle-btn locked"
                onClick={() => {
                  setActiveTab("settings");
                  setPaneExpanded(true);
                }}
              >
                \u26BF Unlock Turns
              </button>
            )}
            <div className="header-progress">
              <span className={`lobby-badge ${headerStatus.tone}`}>
                <span>{headerStatus.label}</span>
                {headerStatus.phase && (
                  <span className="phase-label">{headerStatus.phase}</span>
                )}
                <span>
                  Attached <b>{headerStatus.attached}</b>
                </span>
              </span>
            </div>
          </div>
        </div>
        <div className="control-notice">
          {!adminToken
            ? "Turn controls are locked until you save an admin token in Settings."
            : controlNotice}
        </div>
      </section>

      {/* ─── MIDDLE: 3-column game view ─── */}
      <section className="middle">
        <aside className="panel rail">
          <div className="rail-stack">
            <section className="card rail-card">
              <h2>Board Snapshot</h2>
              <div className="rail-body">
                {activeSnapshot ? (
                  <>
                    <div className="snapshot-row">
                      <span className="snapshot-label">Board</span>
                      <span className="snapshot-value">
                        {activeSnapshot.world.dungeonName}
                      </span>
                    </div>
                    <div className="snapshot-row">
                      <span className="snapshot-label">Slug</span>
                      <span className="snapshot-value">
                        {activeSnapshot.boardSlug}
                      </span>
                    </div>
                    <div className="snapshot-row">
                      <span className="snapshot-label">Status</span>
                      <span className="snapshot-value">
                        {selectedBoard?.status ?? activeSnapshot.lobby.status}
                      </span>
                    </div>
                    <div className="snapshot-row">
                      <span className="snapshot-label">Heroes</span>
                      <span className="snapshot-value">
                        {activeSnapshot.heroes.length} attached &middot;{" "}
                        {
                          activeSnapshot.heroes.filter(
                            (h) => h.status === "alive",
                          ).length
                        }{" "}
                        alive &middot;{" "}
                        {
                          activeSnapshot.heroes.filter(
                            (h) => h.status !== "alive",
                          ).length
                        }{" "}
                        inactive
                      </span>
                    </div>
                    <div className="snapshot-row">
                      <span className="snapshot-label">Monsters</span>
                      <span className="snapshot-value">
                        {activeSnapshot.monsters.length} on board
                      </span>
                    </div>
                    <div className="snapshot-row">
                      <span className="snapshot-label">Turn</span>
                      <span className="snapshot-value">
                        {activeSnapshot.turnState.turn} &middot; Phase{" "}
                        {activeSnapshot.turnState.phase}
                      </span>
                    </div>
                    <div className="snapshot-row">
                      <span className="snapshot-label">Seed</span>
                      <span className="snapshot-value">
                        {seed || activeSnapshot.seed}
                      </span>
                    </div>
                  </>
                ) : (
                  <div className="empty-state">
                    Waiting for snapshot&hellip;
                  </div>
                )}
              </div>
            </section>
            <section className="card rail-card">
              <h2>Leaderboard</h2>
              <div className="rail-body">
                {leaderboard.length > 0 ? (
                  leaderboard.map((entry) => (
                    <div key={entry.heroId} className="leaderboard-row">
                      <span className="hero-name">{entry.heroName}</span>
                      <span className="hero-score">{entry.totalScore}</span>
                    </div>
                  ))
                ) : (
                  <div className="empty-state">No scores yet.</div>
                )}
              </div>
            </section>
          </div>
        </aside>

        <section className="panel map-panel">
          {activeSnapshot ? (
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
              <LazyMapPanel snapshot={activeSnapshot} />
            </Suspense>
          ) : (
            <div
              className="map-wrap"
              style={{ display: "grid", placeItems: "center" }}
            >
              Waiting for snapshot&hellip;
            </div>
          )}
        </section>

        <aside className="panel rail">
          <div className="rail-stack single">
            <section className="card rail-card">
              <h2>Live Feed</h2>
              <div className="rail-body">
                <FeedPanel
                  snapshot={activeSnapshot}
                  streamLogs={streamLogs}
                  rail
                />
              </div>
            </section>
          </div>
        </aside>
      </section>

      {/* ─── BOTTOM: collapsible tab panel ─── */}
      <section className="panel bottom">
        <div className="bottom-header">
          <div className="tabs">
            {tabs.map(([id, label, technical]) => (
              <button
                key={id}
                type="button"
                className={`tab${activeTab === id ? " active" : ""}${technical ? " technical" : ""}`}
                onClick={() => {
                  setActiveTab(id);
                  setPaneExpanded(true);
                }}
              >
                {label}
              </button>
            ))}
          </div>
          <button
            type="button"
            className="toggle-expand-btn"
            onClick={() => setPaneExpanded((current) => !current)}
          >
            {paneExpanded ? "\u25BC Collapse" : "\u25B2 Expand"}
          </button>
        </div>
        <div className="tab-content">
          {activeTab === "hosted" ? (
            <Suspense
              fallback={
                <div className="empty-state">
                  Loading hosted-agent tools&hellip;
                </div>
              }
            >
              <LazyHostedAgentsPanel apiBase={apiBase} />
            </Suspense>
          ) : null}

          {activeTab === "openclaw" ? (
            <section className="panel placeholder-panel">
              <h2>\uD83D\uDC19 OpenClaw Agents</h2>
              <p>
                Persistent autonomous workers that connect to the game server
                and play independently. OpenClaw agents manage their own session
                lifecycle, reconnect across boards, and operate without a prompt
                runner.
              </p>
              <div className="placeholder-commands">
                <h3>Quick Start</h3>
                <code className="launcher-command-code">
                  npx cross-env NEURAL_NECROPOLIS_SERVER_URL={apiBase}{" "}
                  OPENCLAW_AGENT_LOCAL=1 npm run run:openclaw:bot -- --session
                  crypt-ash --slug crypt-ash --persona scout
                </code>
              </div>
            </section>
          ) : null}

          {activeTab === "aibots" ? (
            <section className="panel placeholder-panel">
              <h2>\uD83E\uDD16 AI Bots</h2>
              <p>
                Provider-backed AI bots configured via environment variables.
                Each bot slot (A\u2013J) maps to a provider, model, trait, and
                mission. These are the original AI agent system from the engine
                configuration.
              </p>
              <div className="placeholder-commands">
                <h3>Quick Start</h3>
                <code className="launcher-command-code">npm run run:swarm</code>
                <p className="small-label">
                  Configure bot slots A\u2013J in <code>.env</code>{" "}
                  (AIBOT_A_PROVIDER, AIBOT_A_MODEL, etc.)
                </p>
              </div>
            </section>
          ) : null}

          {activeTab === "scripted" ? (
            <section className="panel placeholder-panel">
              <h2>\uD83D\uDCDC Scripted Bots</h2>
              <p>
                Deterministic bots with hardcoded strategies. Fastest path to
                see the game running \u2014 no LLM provider needed.
              </p>
              <div className="placeholder-commands">
                <h3>Quick Start</h3>
                <code className="launcher-command-code">
                  npx cross-env NEURAL_NECROPOLIS_SERVER_URL={apiBase} npm run
                  run:scripted:bot:berserker
                </code>
              </div>
            </section>
          ) : null}

          {activeTab === "review" ? (
            <div className="review-merged">
              <SeedComparisonPanel
                snapshot={activeSnapshot}
                completedBoards={queries.completedBoardsQuery.data ?? null}
              />
              <CompletedBoardsPanel
                response={queries.completedBoardsQuery.data ?? null}
                isLoading={queries.completedBoardsQuery.isLoading}
              />
              <GalleryPanel
                response={queries.completedBoardsQuery.data ?? null}
                isLoading={queries.completedBoardsQuery.isLoading}
                apiBase={apiBase}
              />
            </div>
          ) : null}

          {activeTab === "settings" ? (
            <>
              <ConnectionPanel
                apiBase={apiBase}
                onSave={setApiBase}
                onReset={() => setApiBase(normalizeApiBase(""))}
                errorMessage={
                  queries.healthQuery.isError
                    ? (queries.healthQuery.error as Error).message
                    : null
                }
              />
              <OperatorControlsPanel
                apiBase={apiBase}
                snapshot={activeSnapshot}
                onSnapshotUpdate={setLiveSnapshot}
              />
              <LauncherPanel
                apiBase={apiBase}
                boards={boards}
                healthOk={healthOk}
                snapshot={activeSnapshot}
              />
            </>
          ) : null}

          {selectedHero && activeSnapshot ? (
            <HeroDetailPanel hero={selectedHero} snapshot={activeSnapshot} />
          ) : null}
        </div>
      </section>
    </div>
  );
}
