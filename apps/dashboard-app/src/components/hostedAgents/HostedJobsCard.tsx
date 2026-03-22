import type { PromptRunnerJob } from "../../api";

type HostedJobsCardProps = {
  isCancelling: boolean;
  jobs: PromptRunnerJob[];
  selectedHostedJobId: string | null;
  onCancelJob: (jobId: string) => void;
  onSelectJob: (jobId: string) => void;
};

export function HostedJobsCard(props: HostedJobsCardProps) {
  const { isCancelling, jobs, selectedHostedJobId, onCancelJob, onSelectJob } =
    props;

  return (
    <div className="hosted-item">
      <h3>Hosted Jobs</h3>
      <div className="hosted-list">
        {jobs.map((job) => (
          <article key={job.id} className="hosted-item">
            <div className="hosted-item-head">
              <div>
                <strong>{job.hero.name}</strong>
                <div className="tiny-label">
                  Manifest {job.manifestId} · Owner {job.ownerId}
                </div>
              </div>
              <span className={`status-pill ${job.status}`}>{job.status}</span>
            </div>
            <div className="hosted-meta">
              <span>Job {job.id}</span>
              <span>Hero Slug {job.hero.id}</span>
              <span>Created {job.createdAt}</span>
              <span>Turn {job.lastTurn ?? "-"}</span>
            </div>
            <div className="hosted-toolbar">
              <button
                type="button"
                className={selectedHostedJobId === job.id ? "" : "ghost"}
                onClick={() => onSelectJob(job.id)}
              >
                {selectedHostedJobId === job.id ? "Selected" : "View Logs"}
              </button>
              {job.status === "queued" || job.status === "running" ? (
                <button
                  type="button"
                  disabled={isCancelling}
                  onClick={() => onCancelJob(job.id)}
                >
                  Cancel Job
                </button>
              ) : null}
            </div>
          </article>
        ))}
        {jobs.length === 0 ? (
          <div className="empty-state">No hosted jobs yet.</div>
        ) : null}
      </div>
    </div>
  );
}
