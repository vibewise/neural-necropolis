import type { PromptDraft } from "../../api";
import {
  buildCommandPolicyOverlay,
  type CommandProfile,
} from "../../commandProfile";

type HostedDraftCardProps = {
  draft: PromptDraft;
  commandProfile: CommandProfile;
  isWorking: boolean;
  onLaunchJob: () => void;
  onResetDraft: () => void;
  onStoreManifest: () => void;
  onUpdateDraft: <K extends keyof PromptDraft>(
    key: K,
    value: PromptDraft[K],
  ) => void;
};

export function HostedDraftCard(props: HostedDraftCardProps) {
  const {
    draft,
    commandProfile,
    isWorking,
    onLaunchJob,
    onResetDraft,
    onStoreManifest,
    onUpdateDraft,
  } = props;

  const overlay = buildCommandPolicyOverlay(commandProfile);
  const hasOverlay = Boolean(overlay.policyAppend || overlay.styleAppend);

  return (
    <div className="hosted-item">
      <h3>Prompt Draft</h3>
      <div className="field-grid">
        <label className="field">
          <span>Manifest Id</span>
          <input
            value={draft.manifestId}
            onChange={(event) =>
              onUpdateDraft("manifestId", event.target.value)
            }
          />
        </label>
        <label className="field">
          <span>Owner Id</span>
          <input
            value={draft.ownerId}
            onChange={(event) => onUpdateDraft("ownerId", event.target.value)}
          />
        </label>
        <label className="field">
          <span>Display Name</span>
          <input
            value={draft.displayName}
            onChange={(event) =>
              onUpdateDraft("displayName", event.target.value)
            }
          />
        </label>
        <label className="field">
          <span>Hero Name</span>
          <input
            value={draft.heroName}
            onChange={(event) => onUpdateDraft("heroName", event.target.value)}
          />
        </label>
        <label className="field">
          <span>Preferred Trait</span>
          <select
            value={draft.preferredTrait}
            onChange={(event) =>
              onUpdateDraft(
                "preferredTrait",
                event.target.value as PromptDraft["preferredTrait"],
              )
            }
          >
            <option value="aggressive">aggressive</option>
            <option value="cautious">cautious</option>
            <option value="greedy">greedy</option>
            <option value="curious">curious</option>
            <option value="resilient">resilient</option>
          </select>
        </label>
        <label className="field">
          <span>Model Profile</span>
          <input
            value={draft.profile}
            onChange={(event) => onUpdateDraft("profile", event.target.value)}
          />
        </label>
        <label className="field">
          <span>Temperature</span>
          <input
            type="number"
            step="0.1"
            value={draft.temperature}
            onChange={(event) =>
              onUpdateDraft("temperature", event.target.value)
            }
          />
        </label>
        <label className="field">
          <span>Max Output Tokens</span>
          <input
            type="number"
            value={draft.maxOutputTokens}
            onChange={(event) =>
              onUpdateDraft("maxOutputTokens", event.target.value)
            }
          />
        </label>
        <label className="field">
          <span>Reasoning Effort</span>
          <select
            value={draft.reasoningEffort}
            onChange={(event) =>
              onUpdateDraft(
                "reasoningEffort",
                event.target.value as PromptDraft["reasoningEffort"],
              )
            }
          >
            <option value="low">low</option>
            <option value="medium">medium</option>
            <option value="high">high</option>
          </select>
        </label>
        <label className="field">
          <span>Requested By</span>
          <input
            value={draft.requestedBy}
            onChange={(event) =>
              onUpdateDraft("requestedBy", event.target.value)
            }
          />
        </label>
        <label className="field">
          <span>Decision Timeout Ms</span>
          <input
            type="number"
            value={draft.decisionTimeoutMs}
            onChange={(event) =>
              onUpdateDraft("decisionTimeoutMs", event.target.value)
            }
          />
        </label>
        <label className="field">
          <span>Max Decision Retries</span>
          <input
            type="number"
            value={draft.maxDecisionRetries}
            onChange={(event) =>
              onUpdateDraft("maxDecisionRetries", event.target.value)
            }
          />
        </label>
        <label className="field">
          <span>Max Consecutive Fallbacks</span>
          <input
            type="number"
            value={draft.maxConsecutiveFallbacks}
            onChange={(event) =>
              onUpdateDraft("maxConsecutiveFallbacks", event.target.value)
            }
          />
        </label>
        <label className="field">
          <span>Cooldown Ms</span>
          <input
            type="number"
            value={draft.cooldownMs}
            onChange={(event) =>
              onUpdateDraft("cooldownMs", event.target.value)
            }
          />
        </label>
        <label className="field full">
          <span>Strategy</span>
          <textarea
            value={draft.strategy}
            onChange={(event) => onUpdateDraft("strategy", event.target.value)}
          />
        </label>
        <label className="field full">
          <span>System Prompt</span>
          <textarea
            value={draft.system}
            onChange={(event) => onUpdateDraft("system", event.target.value)}
          />
        </label>
        <label className="field full">
          <span>Policy Prompt</span>
          <textarea
            value={draft.policy}
            onChange={(event) => onUpdateDraft("policy", event.target.value)}
          />
        </label>
        <label className="field full">
          <span>Persona</span>
          <textarea
            value={draft.persona}
            onChange={(event) => onUpdateDraft("persona", event.target.value)}
          />
        </label>
        <label className="field full">
          <span>Style Notes</span>
          <textarea
            value={draft.styleNotes}
            onChange={(event) =>
              onUpdateDraft("styleNotes", event.target.value)
            }
          />
        </label>
      </div>
      {hasOverlay && (
        <div className="command-overlay-preview">
          <div className="small-label">Commander Directives (auto-applied)</div>
          <pre className="overlay-text">
            {overlay.policyAppend.trim()}
            {overlay.styleAppend ? "\n" + overlay.styleAppend.trim() : ""}
          </pre>
        </div>
      )}
      <div className="hosted-toolbar">
        <button type="button" className="ghost" onClick={onResetDraft}>
          Reset Draft
        </button>
        <button type="button" disabled={isWorking} onClick={onStoreManifest}>
          Store Manifest
        </button>
        <button type="button" disabled={isWorking} onClick={onLaunchJob}>
          Launch Hosted Agent
        </button>
      </div>
    </div>
  );
}
