import type { CompletedBoardsResponse } from "@neural-necropolis/protocol-ts";

type CompletedBoardsPanelProps = {
  response: CompletedBoardsResponse | null;
  isLoading: boolean;
};

export function CompletedBoardsPanel(props: CompletedBoardsPanelProps) {
  const { response, isLoading } = props;

  return (
    <section className="panel notes-panel">
      <h2>Completed Boards</h2>
      <p>Recent finished runs and how they ended.</p>
      {isLoading ? (
        <div className="empty-state">Loading completed runs…</div>
      ) : null}
      {!isLoading && !response?.boards.length ? (
        <div className="empty-state">No completed boards yet.</div>
      ) : null}
      <div className="completed-list">
        {(response?.boards ?? []).map((board) => (
          <article key={board.boardId} className="completed-card">
            <div className="completed-card-header">
              <strong>{board.boardName}</strong>
              <small>Turn {board.turn}</small>
            </div>
            <p>
              {board.boardSlug} · Heroes {board.heroCount} · Monsters left{" "}
              {board.monsterCount}
            </p>
            <small>{board.completionReason || "Completed"}</small>
          </article>
        ))}
      </div>
    </section>
  );
}
