import { FormEvent, useCallback, useEffect, useState } from "react";
import { normalizeApiBase, useDashboardStore } from "../dashboardStore";

export function SettingsDrawer({
  open,
  onClose,
}: {
  open: boolean;
  onClose: () => void;
}) {
  const apiBase = useDashboardStore((state) => state.apiBase);
  const setApiBase = useDashboardStore((state) => state.setApiBase);
  const adminToken = useDashboardStore((state) => state.adminToken);
  const setAdminToken = useDashboardStore((state) => state.setAdminToken);

  const [draftApi, setDraftApi] = useState(apiBase);
  const [draftToken, setDraftToken] = useState(adminToken);

  useEffect(() => {
    if (open) {
      setDraftApi(apiBase);
      setDraftToken(adminToken);
    }
  }, [open, apiBase, adminToken]);

  const handleSave = useCallback(
    (e: FormEvent) => {
      e.preventDefault();
      setApiBase(draftApi);
      setAdminToken(draftToken);
      onClose();
    },
    [draftApi, draftToken, setApiBase, setAdminToken, onClose],
  );

  if (!open) return null;

  return (
    <div className="settings-overlay" onClick={onClose}>
      <div className="settings-drawer" onClick={(e) => e.stopPropagation()}>
        <div className="settings-drawer-header">
          <h2>Settings</h2>
          <button type="button" className="ghost small" onClick={onClose}>
            ✕
          </button>
        </div>
        <form onSubmit={handleSave} className="settings-form">
          <label className="av-field">
            <span>Game Server URL</span>
            <input
              type="url"
              value={draftApi}
              onChange={(e) => setDraftApi(e.target.value)}
              placeholder="http://127.0.0.1:3000"
            />
          </label>
          <label className="av-field">
            <span>Admin Token</span>
            <input
              type="text"
              value={draftToken}
              onChange={(e) => setDraftToken(e.target.value)}
              placeholder="Paste your admin token"
            />
          </label>
          <div className="button-row tight">
            <button type="submit">Save</button>
            <button
              type="button"
              className="ghost"
              onClick={() => {
                setDraftApi(normalizeApiBase(""));
                setDraftToken("");
              }}
            >
              Reset
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
