import { useMemo, useState } from "react";

import type {
  CompletedBoardsResponse,
  DashboardResponse,
} from "@neural-necropolis/protocol-ts";
import { useHeroBuildStore, type SeedHistoryEntry } from "../heroBuildStore";

type SeedComparisonPanelProps = {
  snapshot: DashboardResponse | null;
  completedBoards: CompletedBoardsResponse | null;
};

export function SeedComparisonPanel(props: SeedComparisonPanelProps) {
  const { snapshot, completedBoards } = props;
  const seedHistory = useHeroBuildStore((s) => s.seedHistory);
  const addSeedEntry = useHeroBuildStore((s) => s.addSeedEntry);
  const removeSeedEntry = useHeroBuildStore((s) => s.removeSeedEntry);
  const [noteInput, setNoteInput] = useState("");
  const [compareSeeds, setCompareSeeds] = useState<string[]>([]);

  const currentSeed = snapshot?.seed ?? "";
  const currentBoardId = snapshot?.boardId ?? "";
  const currentBoardName = snapshot?.world.dungeonName ?? "";

  const isSaved = seedHistory.some((s) => s.seed === currentSeed);

  function handleSaveSeed() {
    if (!currentSeed) return;
    addSeedEntry({
      seed: currentSeed,
      boardId: currentBoardId,
      boardName: currentBoardName,
      savedAt: Date.now(),
      notes: noteInput.trim(),
    });
    setNoteInput("");
  }

  function toggleCompare(seed: string) {
    setCompareSeeds((prev) =>
      prev.includes(seed)
        ? prev.filter((s) => s !== seed)
        : prev.length < 4
          ? [...prev, seed]
          : prev,
    );
  }

  // Match completed boards to saved seeds for comparison
  const comparisonData = useMemo(() => {
    if (!completedBoards?.boards.length) return [];
    return compareSeeds
      .map((seed) => {
        const boards = completedBoards.boards.filter((b) => b.seed === seed);
        const saved = seedHistory.find((s) => s.seed === seed);
        return { seed, boards, notes: saved?.notes ?? "" };
      })
      .filter((d) => d.boards.length > 0);
  }, [compareSeeds, completedBoards, seedHistory]);

  return (
    <section className="panel notes-panel">
      <h2>Replayable Seeds</h2>
      <p>
        Save seeds from interesting runs and compare outcomes across repeated
        plays.
      </p>

      {/* Current seed */}
      {currentSeed ? (
        <div className="seed-current">
          <div className="seed-current-row">
            <span className="small-label">Current Seed</span>
            <code className="seed-code">{currentSeed}</code>
            {!isSaved && (
              <>
                <input
                  placeholder="Optional note..."
                  value={noteInput}
                  onChange={(e) => setNoteInput(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") handleSaveSeed();
                  }}
                />
                <button type="button" onClick={handleSaveSeed}>
                  Save Seed
                </button>
              </>
            )}
            {isSaved && <span className="pill">Saved</span>}
          </div>
        </div>
      ) : (
        <div className="empty-state">
          No active board seed. Start a run to see the seed.
        </div>
      )}

      {/* Seed history */}
      {seedHistory.length > 0 && (
        <>
          <h3 style={{ marginTop: 12 }}>Saved Seeds</h3>
          <div className="seed-history-list">
            {seedHistory.map((entry) => (
              <div key={entry.seed} className="seed-history-entry">
                <div className="seed-history-row">
                  <code className="seed-code">{entry.seed}</code>
                  <span className="seed-board-name">{entry.boardName}</span>
                  {entry.notes && (
                    <span className="seed-notes">{entry.notes}</span>
                  )}
                </div>
                <div className="button-row tight">
                  <button
                    type="button"
                    className={`ghost${compareSeeds.includes(entry.seed) ? " active-compare" : ""}`}
                    onClick={() => toggleCompare(entry.seed)}
                  >
                    {compareSeeds.includes(entry.seed)
                      ? "\u2713 Comparing"
                      : "Compare"}
                  </button>
                  <button
                    type="button"
                    className="ghost"
                    onClick={() => {
                      void navigator.clipboard.writeText(entry.seed);
                    }}
                  >
                    Copy
                  </button>
                  <button
                    type="button"
                    className="btn-danger"
                    onClick={() => removeSeedEntry(entry.seed)}
                  >
                    Remove
                  </button>
                </div>
              </div>
            ))}
          </div>
        </>
      )}

      {/* Comparison table */}
      {comparisonData.length > 0 && (
        <>
          <h3 style={{ marginTop: 12 }}>Seed Comparison</h3>
          <div className="seed-comparison-grid">
            {comparisonData.map((data) => (
              <div key={data.seed} className="seed-comparison-card">
                <div className="seed-comparison-header">
                  <code className="seed-code">{data.seed}</code>
                  {data.notes && <small>{data.notes}</small>}
                </div>
                {data.boards.map((board) => (
                  <div key={board.boardId} className="seed-comparison-row">
                    <span>{board.boardName}</span>
                    <span>Turn {board.turn}</span>
                    <span>
                      {board.heroCount} heroes &middot; {board.monsterCount}{" "}
                      monsters left
                    </span>
                    <small>{board.completionReason}</small>
                    {board.topLeaderboard.length > 0 && (
                      <div className="seed-leaderboard-mini">
                        {board.topLeaderboard.slice(0, 3).map((entry) => (
                          <span key={entry.heroId} className="pill">
                            {entry.heroName}: {entry.totalScore}
                          </span>
                        ))}
                      </div>
                    )}
                  </div>
                ))}
              </div>
            ))}
          </div>
        </>
      )}
    </section>
  );
}
