import type { BoardSummary } from "@neural-necropolis/protocol-ts";

type BoardSelectorPanelProps = {
  boards: BoardSummary[];
  isLoading: boolean;
  selectedBoardId: string | null;
  onSelectBoard: (boardId: string | null) => void;
  inline?: boolean;
};

export function BoardSelectorPanel(props: BoardSelectorPanelProps) {
  const { boards, isLoading, selectedBoardId, onSelectBoard, inline = false } =
    props;

  if (inline) {
    return (
      <div className="board-selector-strip">
        {boards.map((board) => (
          <button
            key={board.boardId}
            type="button"
            className={`board-chip${
              selectedBoardId === board.boardId ? " active" : ""
            }`}
            onClick={() => onSelectBoard(board.boardId)}
          >
            <span className="board-chip-title">{board.boardName}</span>
            <span className="board-chip-role">{board.status}</span>
            <span className="board-chip-meta">
              Turn {board.turn} &middot; Heroes {board.heroCount}/
              {board.maxHeroes}
            </span>
          </button>
        ))}
      </div>
    );
  }

  return (
    <section className="panel runtime-panel">
      <h2>Boards</h2>
      <p>
        Select a board or follow the active run. This strip is intentionally
        compact so it can stay visible in the overview layout.
      </p>
      <div className="button-row tight">
        <button
          type="button"
          className="ghost"
          onClick={() => onSelectBoard(null)}
        >
          Follow Active Board
        </button>
      </div>
      {isLoading ? <div className="empty-state">Loading boards&hellip;</div> : null}
      {!isLoading && boards.length === 0 ? (
        <div className="empty-state">No boards are available yet.</div>
      ) : null}
      <div className="board-list compact-scroll">
        {boards.map((board) => {
          const active = selectedBoardId === board.boardId;
          return (
            <button
              key={board.boardId}
              type="button"
              className={`board-chip${active ? " active" : ""}`}
              onClick={() => onSelectBoard(board.boardId)}
            >
              <div className="board-chip-header">
                <strong className="chip-title">{board.boardName}</strong>
                <span className="chip-status">{board.status}</span>
              </div>
              <p>
                Turn {board.turn} &middot; Heroes {board.heroCount}/
                {board.maxHeroes}
              </p>
              <small>
                {board.boardSlug} &middot; {board.seed}
              </small>
            </button>
          );
        })}
      </div>
    </section>
  );
}
