import { lazy, Suspense, useState } from "react";

import { useDashboardStore } from "./dashboardStore";
import { useDashboardStream } from "./hooks/useDashboardStream";
import { SettingsDrawer } from "./components/SettingsDrawer";

const LazyArenaView = lazy(async () => {
  const module = await import("./components/ArenaView");
  return { default: module.ArenaView };
});

type ArenaWorkspaceMode = "workshop" | "arena" | "overview";

export function App() {
  const apiBase = useDashboardStore((state) => state.apiBase);
  const adminToken = useDashboardStore((state) => state.adminToken);
  const pushStreamLog = useDashboardStore((state) => state.pushStreamLog);
  const setStreamState = useDashboardStore((state) => state.setStreamState);

  const [settingsOpen, setSettingsOpen] = useState(false);
  const [mode, setMode] = useState<ArenaWorkspaceMode>("workshop");

  useDashboardStream({
    apiBase,
    onSnapshot: () => {
      /* arena-driven: snapshot handled per-duel, not globally */
    },
    onLog: (message) => {
      pushStreamLog(message, null);
    },
    setStreamState,
  });

  return (
    <div className="arena-shell">
      {/* ─── TOP BAR: brand + settings ─── */}
      <header className="arena-header panel">
        <div className="brand-block">
          <div className="brand-kicker">Arena Of Recursive Ruin</div>
          <h1>Neural Necropolis</h1>
          <div className="subtitle">Where Dead Code Dreams of Vengeance</div>
        </div>
        <div className="arena-header-right">
          <div
            className="arena-mode-toggle"
            role="tablist"
            aria-label="Arena workspace mode"
          >
            <button
              type="button"
              className={`arena-mode-btn${mode === "workshop" ? " active" : ""}`}
              onClick={() => setMode("workshop")}
            >
              Agents
            </button>
            <button
              type="button"
              className={`arena-mode-btn${mode === "arena" ? " active" : ""}`}
              onClick={() => setMode("arena")}
            >
              Arena
            </button>
            <button
              type="button"
              className={`arena-mode-btn${mode === "overview" ? " active" : ""}`}
              onClick={() => setMode("overview")}
            >
              Overview
            </button>
          </div>
          {!adminToken && (
            <span className="arena-token-hint">No admin token set</span>
          )}
          <button
            type="button"
            className="settings-gear"
            onClick={() => setSettingsOpen(true)}
            title="Settings"
          >
            &#x2699;
          </button>
        </div>
      </header>

      {/* ─── MAIN: arena workspace ─── */}
      <main className="arena-body">
        <Suspense
          fallback={
            <div className="empty-state" style={{ padding: 24 }}>
              Loading arena&hellip;
            </div>
          }
        >
          <LazyArenaView apiBase={apiBase} mode={mode} />
        </Suspense>
      </main>

      {/* ─── Settings drawer ─── */}
      <SettingsDrawer
        open={settingsOpen}
        onClose={() => setSettingsOpen(false)}
      />
    </div>
  );
}
