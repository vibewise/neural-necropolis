import { useMemo, useState } from "react";

import type {
  CompletedBoard,
  CompletedBoardsResponse,
} from "@neural-necropolis/protocol-ts";
import { buildShareUrl, copyToClipboard } from "./sharing";

type GalleryPanelProps = {
  response: CompletedBoardsResponse | null;
  isLoading: boolean;
  apiBase: string;
};

type SortKey = "turn" | "heroes" | "seed" | "name";

export function GalleryPanel(props: GalleryPanelProps) {
  const { response, isLoading, apiBase } = props;
  const [sortBy, setSortBy] = useState<SortKey>("turn");
  const [sortAsc, setSortAsc] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [copyFeedback, setCopyFeedback] = useState("");

  const boards = useMemo(() => {
    const list = [...(response?.boards ?? [])];
    list.sort((a, b) => {
      let cmp = 0;
      switch (sortBy) {
        case "turn":
          cmp = a.turn - b.turn;
          break;
        case "heroes":
          cmp = a.heroCount - b.heroCount;
          break;
        case "seed":
          cmp = a.seed.localeCompare(b.seed);
          break;
        case "name":
          cmp = a.boardName.localeCompare(b.boardName);
          break;
      }
      return sortAsc ? cmp : -cmp;
    });
    return list;
  }, [response, sortBy, sortAsc]);

  const selectedBoards = useMemo(
    () => boards.filter((b) => selectedIds.has(b.boardId)),
    [boards, selectedIds],
  );

  function toggleSort(key: SortKey) {
    if (sortBy === key) {
      setSortAsc(!sortAsc);
    } else {
      setSortBy(key);
      setSortAsc(false);
    }
  }

  function toggleSelect(boardId: string) {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(boardId)) {
        next.delete(boardId);
      } else if (next.size < 6) {
        next.add(boardId);
      }
      return next;
    });
  }

  async function handleShareBoard(board: CompletedBoard) {
    const url = buildShareUrl({
      apiBase,
      seed: board.seed,
      boardId: board.boardId,
    });
    const ok = await copyToClipboard(url);
    setCopyFeedback(ok ? `Copied link for ${board.boardName}` : "Copy failed");
    setTimeout(() => setCopyFeedback(""), 2000);
  }

  const sortIndicator = (key: SortKey) =>
    sortBy === key ? (sortAsc ? " \u25B2" : " \u25BC") : "";

  return (
    <section className="panel notes-panel">
      <h2>Run Gallery</h2>
      <p>
        Browse completed runs, compare outcomes, and share links.
        {selectedBoards.length > 0 &&
          ` ${selectedBoards.length} selected for comparison.`}
      </p>

      {copyFeedback && <div className="gallery-feedback">{copyFeedback}</div>}

      {isLoading && (
        <div className="empty-state">Loading completed runs&hellip;</div>
      )}

      {!isLoading && boards.length === 0 && (
        <div className="empty-state">No completed boards yet.</div>
      )}

      {boards.length > 0 && (
        <>
          {/* Sort controls */}
          <div className="gallery-sort-row">
            <span className="small-label">Sort by:</span>
            {(["name", "turn", "heroes", "seed"] as SortKey[]).map((key) => (
              <button
                key={key}
                type="button"
                className={`ghost${sortBy === key ? " active-compare" : ""}`}
                onClick={() => toggleSort(key)}
              >
                {key}
                {sortIndicator(key)}
              </button>
            ))}
          </div>

          {/* Board cards */}
          <div className="gallery-grid">
            {boards.map((board) => (
              <article
                key={board.boardId}
                className={`gallery-card${selectedIds.has(board.boardId) ? " selected" : ""}`}
              >
                <div className="gallery-card-header">
                  <label className="gallery-select">
                    <input
                      type="checkbox"
                      checked={selectedIds.has(board.boardId)}
                      onChange={() => toggleSelect(board.boardId)}
                    />
                  </label>
                  <strong>{board.boardName}</strong>
                  <small className="gallery-turn">Turn {board.turn}</small>
                </div>
                <div className="gallery-card-body">
                  <div>
                    <span className="small-label">Seed</span>
                    <code className="seed-code">{board.seed}</code>
                  </div>
                  <div>
                    {board.heroCount} heroes &middot; {board.monsterCount}{" "}
                    monsters left
                  </div>
                  <div className="gallery-reason">
                    {board.completionReason || "Completed"}
                  </div>
                  {board.topLeaderboard.length > 0 && (
                    <div className="gallery-leaderboard">
                      {board.topLeaderboard.slice(0, 3).map((entry, i) => (
                        <div key={entry.heroId} className="gallery-score-row">
                          <span className="gallery-rank">#{i + 1}</span>
                          <span>{entry.heroName}</span>
                          <span className="gallery-score">
                            {entry.totalScore}
                          </span>
                          <span className="gallery-score-detail">
                            C{entry.combatScore} T{entry.treasureScore} E
                            {entry.explorationScore}
                          </span>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
                <div className="button-row tight">
                  <button
                    type="button"
                    className="ghost"
                    onClick={() => void handleShareBoard(board)}
                  >
                    Share Link
                  </button>
                </div>
              </article>
            ))}
          </div>
        </>
      )}

      {/* Comparison panel */}
      {selectedBoards.length >= 2 && (
        <div className="gallery-comparison">
          <h3>Side-by-Side Comparison</h3>
          <div className="gallery-comparison-grid">
            {selectedBoards.map((board) => (
              <div key={board.boardId} className="gallery-comparison-col">
                <h4>{board.boardName}</h4>
                <div className="gallery-comparison-stats">
                  <div>
                    Seed: <code>{board.seed}</code>
                  </div>
                  <div>Turns: {board.turn}</div>
                  <div>Heroes: {board.heroCount}</div>
                  <div>Monsters left: {board.monsterCount}</div>
                  <div>{board.completionReason}</div>
                  {board.topLeaderboard.slice(0, 5).map((entry) => (
                    <div key={entry.heroId} className="gallery-score-row">
                      <span>
                        {entry.heroName}: {entry.totalScore}
                      </span>
                      <span className="gallery-score-detail">
                        ({entry.status}
                        {entry.escaped ? " \u2713 escaped" : ""})
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </section>
  );
}
