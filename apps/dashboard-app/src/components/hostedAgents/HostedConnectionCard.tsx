import type { HostedStatusTone } from "../../hooks/useHostedAgents";

type HostedConnectionCardProps = {
  activeJobs: number;
  dataDir: string;
  draftBase: string;
  draftToken: string;
  isClearing: boolean;
  isError: boolean;
  isLoading: boolean;
  jobs: number;
  manifests: number;
  statusMessage: string;
  statusTone: HostedStatusTone;
  onClearHostedData: () => void;
  onChangeBase: (value: string) => void;
  onChangeToken: (value: string) => void;
  onRefresh: () => void;
  onSaveConnection: () => void;
};

export function HostedConnectionCard(props: HostedConnectionCardProps) {
  const {
    activeJobs,
    dataDir,
    draftBase,
    draftToken,
    isClearing,
    isError,
    isLoading,
    jobs,
    manifests,
    statusMessage,
    statusTone,
    onClearHostedData,
    onChangeBase,
    onChangeToken,
    onRefresh,
    onSaveConnection,
  } = props;

  return (
    <div className="hosted-item">
      <h3>Prompt Runner</h3>
      <div className="field-grid">
        <label className="field">
          <span>Control Plane URL</span>
          <input
            type="url"
            value={draftBase}
            onChange={(event) => onChangeBase(event.target.value)}
            placeholder="http://127.0.0.1:4010"
          />
        </label>
        <label className="field">
          <span>Runner Admin Token</span>
          <input
            type="password"
            value={draftToken}
            onChange={(event) => onChangeToken(event.target.value)}
            placeholder="Optional bearer token"
          />
        </label>
      </div>

      <div className="hosted-toolbar">
        <button type="button" onClick={onSaveConnection}>
          Save Connection
        </button>
        <button type="button" className="ghost" onClick={onRefresh}>
          Refresh State
        </button>
      </div>

      <div className={`hosted-status ${statusTone}`}>{statusMessage}</div>

      <div className="hosted-storage-path">
        <span className="tiny-label">Storage Directory</span>
        <strong>{dataDir || "Unavailable until the runner responds."}</strong>
      </div>

      <div className="hosted-metrics">
        <div className="metric">
          <span className="tiny-label">Runner</span>
          <strong>
            {isLoading ? "checking" : isError ? "offline" : "online"}
          </strong>
        </div>
        <div className="metric">
          <span className="tiny-label">Manifests</span>
          <strong>{manifests}</strong>
        </div>
        <div className="metric">
          <span className="tiny-label">Jobs</span>
          <strong>{jobs}</strong>
        </div>
        <div className="metric">
          <span className="tiny-label">Active Jobs</span>
          <strong>{activeJobs}</strong>
        </div>
      </div>

      <div className="hosted-danger-zone">
        <div>
          <div className="small-label">Cleanup</div>
          <p>
            Hosted manifests, jobs, and logs are stored in the directory above.
            Clear them all once no hosted jobs are still active.
          </p>
        </div>
        <button
          type="button"
          className="btn-danger"
          disabled={isClearing || activeJobs > 0}
          onClick={onClearHostedData}
        >
          Remove All Hosted Data
        </button>
      </div>
    </div>
  );
}
