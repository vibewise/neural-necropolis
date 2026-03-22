import type { DashboardResponse } from "../api";
import { useOperatorControls } from "../hooks/useOperatorControls";

type OperatorControlsPanelProps = {
  apiBase: string;
  onSnapshotUpdate: (snapshot: DashboardResponse) => void;
  snapshot: DashboardResponse | null;
};

export function OperatorControlsPanel(props: OperatorControlsPanelProps) {
  const { apiBase, onSnapshotUpdate, snapshot } = props;
  const operator = useOperatorControls({ apiBase, onSnapshotUpdate, snapshot });
  const turnsRunning = !operator.settings.paused;
  const busy =
    operator.saveSettingsMutation.isPending ||
    operator.toggleTurnsMutation.isPending ||
    operator.startBoardMutation.isPending ||
    operator.stopBoardMutation.isPending ||
    operator.resetBoardMutation.isPending;

  return (
    <section className="panel operator-panel">
      <h2>Operator Controls</h2>
      <p>
        Save an admin token in this browser, then manage turns, prompt
        information settings, and board lifecycle directly from the new app.
      </p>

      <div className="operator-grid">
        <div className="operator-card">
          <h3>Admin Access</h3>
          <label className="field">
            <span>Admin Token</span>
            <input
              type="password"
              value={operator.draftToken}
              onChange={(event) => operator.setDraftToken(event.target.value)}
              placeholder="Admin token for dashboard controls"
            />
          </label>
          <div className="button-row tight">
            <button type="button" onClick={operator.saveAdminToken}>
              Save Token
            </button>
            <button
              type="button"
              className="ghost"
              onClick={() => void operator.settingsQuery.refetch()}
              disabled={!operator.adminToken}
            >
              Refresh Settings
            </button>
          </div>
          <div className="operator-readout">
            {operator.adminToken
              ? "Admin token loaded for operator actions."
              : "Read-only until you save an admin token."}
          </div>
        </div>

        <div className="operator-card">
          <h3>Turns And Board State</h3>
          <div className="operator-toggle-row">
            <div>
              <strong>{turnsRunning ? "Turns ON" : "Turns OFF"}</strong>
              <div className="tiny-label">
                {turnsRunning
                  ? "The engine will auto-start and advance turns."
                  : "The engine stays paused until you resume it."}
              </div>
            </div>
            <button
              type="button"
              disabled={
                !operator.adminToken || operator.toggleTurnsMutation.isPending
              }
              onClick={() => operator.toggleTurnsMutation.mutate(!turnsRunning)}
            >
              {turnsRunning ? "Pause Turns" : "Resume Turns"}
            </button>
          </div>
          <div className="button-row tight">
            <button
              type="button"
              className="ghost"
              disabled={!operator.adminToken || busy}
              onClick={() => operator.startBoardMutation.mutate()}
            >
              Start Board
            </button>
            <button
              type="button"
              className="ghost"
              disabled={!operator.adminToken || busy}
              onClick={() => operator.stopBoardMutation.mutate()}
            >
              Stop Board
            </button>
            <button
              type="button"
              className="ghost"
              disabled={!operator.adminToken || busy}
              onClick={() => operator.resetBoardMutation.mutate()}
            >
              Reset Board
            </button>
          </div>
        </div>

        <div className="operator-card operator-span">
          <h3>Bot Information Settings</h3>
          <div className="field-grid compact-fields">
            <label className="field">
              <span>Submit Window Ms</span>
              <input
                type="number"
                min="250"
                value={operator.settings.submitWindowMs}
                onChange={(event) =>
                  operator.updateSettings({
                    submitWindowMs: Number(event.target.value || 0),
                  })
                }
              />
            </label>
            <label className="field">
              <span>Resolve Window Ms</span>
              <input
                type="number"
                min="50"
                value={operator.settings.resolveWindowMs}
                onChange={(event) =>
                  operator.updateSettings({
                    resolveWindowMs: Number(event.target.value || 0),
                  })
                }
              />
            </label>
          </div>
          <div className="button-row tight">
            <button
              type="button"
              disabled={
                !operator.adminToken || operator.saveSettingsMutation.isPending
              }
              onClick={() => operator.saveSettingsMutation.mutate()}
            >
              Save Settings
            </button>
          </div>
        </div>
      </div>

      {operator.statusMessage ? (
        <div className={`hosted-status ${operator.statusTone}`}>
          {operator.statusMessage}
        </div>
      ) : null}
    </section>
  );
}
