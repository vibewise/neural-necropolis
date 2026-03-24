import type { DashboardResponse } from "@neural-necropolis/protocol-ts";

import type { StreamLogEntry } from "../dashboardStore";
import { buildFeedItems } from "../dashboardModel";

type FeedPanelProps = {
  snapshot: DashboardResponse | null;
  streamLogs: StreamLogEntry[];
  rail?: boolean;
};

export function FeedPanel(props: FeedPanelProps) {
  const { snapshot, streamLogs, rail = false } = props;
  const feedItems = buildFeedItems(snapshot, streamLogs);

  if (rail) {
    if (feedItems.length === 0) {
      return <div className="empty-state">No feed items yet.</div>;
    }
    return (
      <>
        {feedItems.map((item) => (
          <article
            key={item.id}
            className={`feed-msg${item.tone ? ` feed-msg--${item.tone}` : ""}`}
          >
            <div className="feed-meta">
              <span className="feed-label">{item.label}</span>
            </div>
            <div className="feed-text">{item.detail}</div>
          </article>
        ))}
      </>
    );
  }

  return (
    <section className="panel notes-panel">
      <h2>Feed</h2>
      <p>
        Latest engine, bot, and stream messages for the board you are viewing.
      </p>
      {feedItems.length === 0 ? (
        <div className="empty-state">No feed items yet.</div>
      ) : (
        <div className="feed-list capped-feed">
          {feedItems.map((item) => (
            <article
              key={item.id}
              className={`feed-entry${item.tone ? ` feed-entry--${item.tone}` : ""}`}
            >
              <div className="feed-entry-header">
                <strong className="feed-label">{item.label}</strong>
              </div>
              <p>{item.detail}</p>
            </article>
          ))}
        </div>
      )}
    </section>
  );
}
