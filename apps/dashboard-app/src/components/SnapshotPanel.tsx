import { lazy, Suspense } from "react";

import type {
  BoardSummary,
  DashboardResponse,
  ScoreTrack,
} from "@neural-necropolis/protocol-ts";

import {
  buildBoardSummaryStats,
  formatHeroStatus,
  formatPhase,
} from "../dashboardModel";

const LazyMapPanel = lazy(async () => {
  const module = await import("./MapPanel");
  return { default: module.MapPanel };
});

type SnapshotPanelProps = {
  snapshot: DashboardResponse | null;
  selectedBoard: BoardSummary | null;
  leaderboard: ScoreTrack[];
  seed: string;
};

export function SnapshotPanel(props: SnapshotPanelProps) {
  const { snapshot, selectedBoard, leaderboard, seed } = props;

  if (!snapshot) {
    return (
      <section className="panel notes-panel">
        <h2>Board Snapshot</h2>
        <div className="empty-state">Waiting for dashboard snapshot…</div>
      </section>
    );
  }

  const topScores = leaderboard.length > 0 ? leaderboard : snapshot.leaderboard;
  const stats = buildBoardSummaryStats(snapshot);

  return (
    <section className="panel notes-panel snapshot-panel">
      <h2>Board Snapshot</h2>
      <div className="snapshot-layout">
        <aside className="snapshot-sidebar">
          <div className="summary-grid snapshot-summary-grid">
            <article className="summary-stat">
              <span>Board</span>
              <strong>{snapshot.world.dungeonName}</strong>
            </article>
            <article className="summary-stat">
              <span>Status</span>
              <strong>{selectedBoard?.status ?? snapshot.lobby.status}</strong>
            </article>
            <article className="summary-stat">
              <span>Seed</span>
              <strong>{seed || snapshot.seed}</strong>
            </article>
            <article className="summary-stat">
              <span>Phase</span>
              <strong>{formatPhase(snapshot.turnState, snapshot.lobby)}</strong>
            </article>
            {stats.map((stat) => (
              <article key={stat.label} className="summary-stat">
                <span>{stat.label}</span>
                <strong>{stat.value}</strong>
              </article>
            ))}
          </div>

          <section className="snapshot-subpanel">
            <div className="completed-card-header">
              <strong>Heroes</strong>
              <small>{snapshot.heroes.length} attached</small>
            </div>
            <div className="mini-list">
              {snapshot.heroes.slice(0, 6).map((hero) => (
                <article key={hero.id} className="mini-list-item">
                  <strong>{hero.name}</strong>
                  <p>
                    {hero.trait} · {formatHeroStatus(hero, snapshot.lobby)}
                  </p>
                  <small>
                    HP {hero.stats.hp}/{hero.stats.maxHp} · Score {hero.score}
                  </small>
                </article>
              ))}
              {snapshot.heroes.length === 0 ? (
                <div className="empty-state">No heroes attached yet.</div>
              ) : null}
            </div>
          </section>

          <section className="snapshot-subpanel">
            <div className="completed-card-header">
              <strong>Leaderboard</strong>
              <small>{topScores.length} entries</small>
            </div>
            <div className="mini-list">
              {topScores.slice(0, 5).map((entry) => (
                <article key={entry.heroId} className="mini-list-item">
                  <strong>{entry.heroName}</strong>
                  <small>
                    {entry.totalScore} pts · {entry.status}
                  </small>
                </article>
              ))}
              {topScores.length === 0 ? (
                <div className="empty-state">No scores yet.</div>
              ) : null}
            </div>
          </section>
        </aside>

        <div className="snapshot-main">
          <Suspense
            fallback={
              <section className="map-shell">
                <h2>Map</h2>
                <div className="map-wrap map-loading">Loading Pixi map…</div>
              </section>
            }
          >
            <LazyMapPanel snapshot={snapshot} />
          </Suspense>
        </div>
      </div>
    </section>
  );
}
