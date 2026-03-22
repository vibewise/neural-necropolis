import { useState } from "react";

import {
  DEFAULT_COMMAND_PROFILE,
  RISK_LABELS,
  OBJECTIVE_LABELS,
  COMBAT_LABELS,
  LOOT_LABELS,
  type CommandProfile,
} from "../../commandProfile";

type CommandControlsCardProps = {
  profile: CommandProfile;
  onUpdateProfile: (profile: CommandProfile) => void;
};

export function CommandControlsCard(props: CommandControlsCardProps) {
  const { profile, onUpdateProfile } = props;
  const [ruleInput, setRuleInput] = useState("");

  function update<K extends keyof CommandProfile>(
    key: K,
    value: CommandProfile[K],
  ) {
    onUpdateProfile({ ...profile, [key]: value });
  }

  function addRule() {
    const trimmed = ruleInput.trim();
    if (!trimmed) return;
    update("customRules", [...profile.customRules, trimmed]);
    setRuleInput("");
  }

  function removeRule(index: number) {
    update(
      "customRules",
      profile.customRules.filter((_, i) => i !== index),
    );
  }

  return (
    <div className="hosted-item">
      <h3>Command Controls</h3>
      <p className="archetype-hint">
        Fine-tune hero behavior with risk posture, priorities, and hard rules.
      </p>

      <div className="command-controls-grid">
        <label className="field">
          <span>Risk Posture</span>
          <select
            value={profile.riskPosture}
            onChange={(e) =>
              update(
                "riskPosture",
                e.target.value as CommandProfile["riskPosture"],
              )
            }
          >
            {Object.entries(RISK_LABELS).map(([k, label]) => (
              <option key={k} value={k}>
                {label}
              </option>
            ))}
          </select>
        </label>

        <label className="field">
          <span>Objective Priority</span>
          <select
            value={profile.objectivePriority}
            onChange={(e) =>
              update(
                "objectivePriority",
                e.target.value as CommandProfile["objectivePriority"],
              )
            }
          >
            {Object.entries(OBJECTIVE_LABELS).map(([k, label]) => (
              <option key={k} value={k}>
                {label}
              </option>
            ))}
          </select>
        </label>

        <label className="field">
          <span>Combat Tolerance</span>
          <select
            value={profile.combatTolerance}
            onChange={(e) =>
              update(
                "combatTolerance",
                e.target.value as CommandProfile["combatTolerance"],
              )
            }
          >
            {Object.entries(COMBAT_LABELS).map(([k, label]) => (
              <option key={k} value={k}>
                {label}
              </option>
            ))}
          </select>
        </label>

        <label className="field">
          <span>Loot Bias</span>
          <select
            value={profile.lootBias}
            onChange={(e) =>
              update("lootBias", e.target.value as CommandProfile["lootBias"])
            }
          >
            {Object.entries(LOOT_LABELS).map(([k, label]) => (
              <option key={k} value={k}>
                {label}
              </option>
            ))}
          </select>
        </label>

        <label className="field full">
          <span>Escape HP Threshold: {profile.escapeThreshold}%</span>
          <input
            type="range"
            min="0"
            max="80"
            step="5"
            value={profile.escapeThreshold}
            onChange={(e) => update("escapeThreshold", Number(e.target.value))}
          />
        </label>

        <div className="field full custom-rules-section">
          <span className="small-label">
            Hard Rules &amp; Safety Constraints
          </span>
          {profile.customRules.length > 0 && (
            <ul className="custom-rules-list">
              {profile.customRules.map((rule, i) => (
                <li key={i}>
                  <span>{rule}</span>
                  <button
                    type="button"
                    className="rule-remove-btn"
                    onClick={() => removeRule(i)}
                  >
                    &times;
                  </button>
                </li>
              ))}
            </ul>
          )}
          <div className="rule-input-row">
            <input
              placeholder="Add a hard behavioral rule..."
              value={ruleInput}
              onChange={(e) => setRuleInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  addRule();
                }
              }}
            />
            <button type="button" onClick={addRule}>
              Add
            </button>
          </div>
        </div>
      </div>

      <div className="button-row tight">
        <button
          type="button"
          className="ghost"
          onClick={() => onUpdateProfile(DEFAULT_COMMAND_PROFILE)}
        >
          Reset to Defaults
        </button>
      </div>
    </div>
  );
}
