import { useCallback, useState } from "react";

import type { PromptDraft } from "../api";
import type { CommandProfile } from "../commandProfile";
import {
  createHeroBuild,
  exportBuild,
  importBuild,
  useHeroBuildStore,
  type HeroBuild,
} from "../heroBuildStore";

type RosterPanelProps = {
  currentDraft: PromptDraft;
  currentCommandProfile: CommandProfile;
  currentArchetypeId: string | null;
  onLoadBuild: (build: HeroBuild) => void;
};

export function RosterPanel(props: RosterPanelProps) {
  const {
    currentDraft,
    currentCommandProfile,
    currentArchetypeId,
    onLoadBuild,
  } = props;
  const builds = useHeroBuildStore((s) => s.builds);
  const addBuild = useHeroBuildStore((s) => s.addBuild);
  const removeBuild = useHeroBuildStore((s) => s.removeBuild);
  const updateBuild = useHeroBuildStore((s) => s.updateBuild);

  const [saveName, setSaveName] = useState("");
  const [importText, setImportText] = useState("");
  const [importError, setImportError] = useState("");
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editNotes, setEditNotes] = useState("");

  const handleSave = useCallback(() => {
    const name =
      saveName.trim() || currentDraft.displayName || "Untitled Build";
    const build = createHeroBuild(
      name,
      currentDraft,
      currentCommandProfile,
      currentArchetypeId,
    );
    addBuild(build);
    setSaveName("");
  }, [
    saveName,
    currentDraft,
    currentCommandProfile,
    currentArchetypeId,
    addBuild,
  ]);

  const handleImport = useCallback(() => {
    const build = importBuild(importText);
    if (!build) {
      setImportError("Invalid build JSON. Check the format and try again.");
      return;
    }
    addBuild(build);
    setImportText("");
    setImportError("");
  }, [importText, addBuild]);

  const handleExport = useCallback((build: HeroBuild) => {
    const json = exportBuild(build);
    void navigator.clipboard.writeText(json).catch(() => {
      // Fallback: show as alert for manual copy if clipboard fails
      window.prompt("Copy this build JSON:", json);
    });
  }, []);

  return (
    <section className="panel notes-panel">
      <h2>Hero Roster</h2>
      <p>Save, load, import, and export hero builds.</p>

      {/* Save current draft */}
      <div className="roster-save-row">
        <input
          placeholder="Build name (optional)"
          value={saveName}
          onChange={(e) => setSaveName(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") handleSave();
          }}
        />
        <button type="button" onClick={handleSave}>
          Save Current Build
        </button>
      </div>

      {/* Builds list */}
      {builds.length === 0 ? (
        <div className="empty-state">
          No saved builds yet. Configure a hero in Hosted Agents and save it
          here.
        </div>
      ) : (
        <div className="roster-list">
          {builds.map((build) => (
            <article key={build.id} className="roster-card">
              <div className="roster-card-header">
                <strong>{build.name}</strong>
                <div className="roster-card-meta">
                  <span className="trait-pill">
                    {build.draft.preferredTrait}
                  </span>
                  {build.archetypeId && (
                    <span className="pill">{build.archetypeId}</span>
                  )}
                </div>
              </div>
              <div className="roster-card-details">
                <small>
                  {build.draft.heroName} &middot;{" "}
                  {build.draft.strategy.slice(0, 60)}
                  {build.draft.strategy.length > 60 ? "\u2026" : ""}
                </small>
              </div>
              {editingId === build.id ? (
                <div className="roster-notes-edit">
                  <textarea
                    value={editNotes}
                    placeholder="Notes about this build..."
                    onChange={(e) => setEditNotes(e.target.value)}
                  />
                  <div className="button-row tight">
                    <button
                      type="button"
                      onClick={() => {
                        updateBuild(build.id, { notes: editNotes });
                        setEditingId(null);
                      }}
                    >
                      Save Notes
                    </button>
                    <button
                      type="button"
                      className="ghost"
                      onClick={() => setEditingId(null)}
                    >
                      Cancel
                    </button>
                  </div>
                </div>
              ) : (
                build.notes && (
                  <div className="roster-card-notes">
                    <small>{build.notes}</small>
                  </div>
                )
              )}
              <div className="button-row tight">
                <button type="button" onClick={() => onLoadBuild(build)}>
                  Load
                </button>
                <button
                  type="button"
                  className="ghost"
                  onClick={() => handleExport(build)}
                >
                  Export
                </button>
                <button
                  type="button"
                  className="ghost"
                  onClick={() => {
                    setEditingId(build.id);
                    setEditNotes(build.notes);
                  }}
                >
                  Notes
                </button>
                <button
                  type="button"
                  className="btn-danger"
                  onClick={() => removeBuild(build.id)}
                >
                  Delete
                </button>
              </div>
            </article>
          ))}
        </div>
      )}

      {/* Import */}
      <details className="roster-import">
        <summary>Import Build from JSON</summary>
        <textarea
          value={importText}
          placeholder="Paste a build JSON here..."
          onChange={(e) => {
            setImportText(e.target.value);
            setImportError("");
          }}
        />
        {importError && <div className="import-error">{importError}</div>}
        <button type="button" onClick={handleImport}>
          Import
        </button>
      </details>
    </section>
  );
}
