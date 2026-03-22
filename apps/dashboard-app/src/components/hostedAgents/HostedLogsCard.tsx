import type { JobLogEntry } from "../../api";

type HostedLogsCardProps = {
  logs: JobLogEntry[];
  selectedHostedJobId: string | null;
};

export function HostedLogsCard(props: HostedLogsCardProps) {
  const { logs, selectedHostedJobId } = props;

  return (
    <div className="hosted-item hosted-span">
      <h3>Job Logs</h3>
      <div className="tiny-label">
        {selectedHostedJobId
          ? `Showing logs for ${selectedHostedJobId}`
          : "Select a hosted job to inspect its worker log."}
      </div>
      <div className="log-list">
        {logs
          .slice()
          .reverse()
          .map((entry, index) => (
            <article key={`${entry.timestamp}-${index}`} className="log-entry">
              <div className="feed-entry-header">
                <strong>{entry.level.toUpperCase()}</strong>
                <small>{entry.timestamp}</small>
              </div>
              <p>{entry.message}</p>
            </article>
          ))}
        {selectedHostedJobId && logs.length === 0 ? (
          <div className="empty-state">No logs recorded for this job yet.</div>
        ) : null}
      </div>
    </div>
  );
}
