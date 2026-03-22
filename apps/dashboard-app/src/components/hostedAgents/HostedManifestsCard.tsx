type StoredManifestSummary = {
  createdAt: string;
  displayName: string;
  id: string;
  ownerId: string;
  revision: number;
  updatedAt: string;
};

type HostedManifestsCardProps = {
  manifests: StoredManifestSummary[];
};

export function HostedManifestsCard(props: HostedManifestsCardProps) {
  const { manifests } = props;

  return (
    <div className="hosted-item">
      <h3>Stored Manifests</h3>
      <div className="hosted-list">
        {manifests.map((record) => (
          <article key={record.id} className="hosted-item">
            <div className="hosted-item-head">
              <div>
                <strong>{record.displayName || record.id}</strong>
                <div className="tiny-label">
                  Manifest {record.id} · Owner {record.ownerId}
                </div>
              </div>
              <span className="status-pill">rev {record.revision}</span>
            </div>
            <div className="hosted-meta">
              <span>Created {record.createdAt}</span>
              <span>Updated {record.updatedAt}</span>
            </div>
          </article>
        ))}
        {manifests.length === 0 ? (
          <div className="empty-state">No stored manifests yet.</div>
        ) : null}
      </div>
    </div>
  );
}
