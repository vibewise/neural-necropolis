import { useState } from "react";

import { applyArchetype, type Archetype } from "../archetypes";
import {
  DEFAULT_COMMAND_PROFILE,
  buildCommandPolicyOverlay,
  type CommandProfile,
} from "../commandProfile";
import { useHostedAgents } from "../hooks/useHostedAgents";
import { ArchetypePresetsCard } from "./hostedAgents/ArchetypePresetsCard";
import { CommandControlsCard } from "./hostedAgents/CommandControlsCard";
import { HostedDraftCard } from "./hostedAgents/HostedDraftCard";
import { HostedManifestPreview } from "./hostedAgents/HostedManifestPreview";
import { RosterPanel } from "./RosterPanel";

type HostedSubTab = "build" | "saved";

type HostedAgentsPanelProps = {
  apiBase: string;
};

const BUILD_STEPS = [
  { key: "archetype", label: "1. Archetype" },
  { key: "controls", label: "2. Commands" },
  { key: "draft", label: "3. Prompt" },
  { key: "preview", label: "4. Review & Save" },
] as const;

type BuildStep = (typeof BUILD_STEPS)[number]["key"];

export function HostedAgentsPanel({ apiBase }: HostedAgentsPanelProps) {
  const hosted = useHostedAgents({ apiBase });
  const [subTab, setSubTab] = useState<HostedSubTab>("build");
  const [buildStep, setBuildStep] = useState<BuildStep>("archetype");
  const [activeArchetypeId, setActiveArchetypeId] = useState<string | null>(
    null,
  );
  const [commandProfile, setCommandProfile] = useState<CommandProfile>(
    DEFAULT_COMMAND_PROFILE,
  );
  const [manifestOpen, setManifestOpen] = useState(false);

  function handleSelectArchetype(archetype: Archetype) {
    const nextDraft = applyArchetype(hosted.draft, archetype);
    setActiveArchetypeId(archetype.id);
    hosted.replaceDraft(nextDraft);
  }

  function handleSaveAgent() {
    hosted.saveBuild(
      {
        commandProfile,
        archetypeId: activeArchetypeId,
      },
      {
        onSuccess: () => {
          setSubTab("saved");
        },
      },
    );
  }

  const overlay = buildCommandPolicyOverlay(commandProfile);
  const hasOverlay = Boolean(overlay.policyAppend || overlay.styleAppend);

  const subTabs: Array<[HostedSubTab, string]> = [
    ["build", "\uD83D\uDEE0 Build Agent"],
    ["saved", "\uD83D\uDCCB Saved Agents"],
  ];

  return (
    <section className="hosted-panel">
      {/* Sub-tab navigation */}
      <div className="hosted-sub-tabs">
        {subTabs.map(([id, label]) => (
          <button
            key={id}
            type="button"
            className={`hosted-sub-tab${subTab === id ? " active" : ""}`}
            onClick={() => setSubTab(id)}
          >
            {label}
          </button>
        ))}
      </div>

      {/* ─── BUILD AGENT TAB ─── */}
      {subTab === "build" && (
        <div className="hosted-build">
          {/* Step indicators */}
          <div className="build-steps">
            {BUILD_STEPS.map((step) => (
              <button
                key={step.key}
                type="button"
                className={`build-step-btn${buildStep === step.key ? " active" : ""}${isStepComplete(step.key, activeArchetypeId, commandProfile) ? " done" : ""}`}
                onClick={() => setBuildStep(step.key)}
              >
                {step.label}
              </button>
            ))}
          </div>

          {/* Step content */}
          <div className="build-step-content">
            {buildStep === "archetype" && (
              <div className="build-section">
                <ArchetypePresetsCard
                  activeArchetypeId={activeArchetypeId}
                  onSelectArchetype={handleSelectArchetype}
                />
                <div className="hosted-slot-summary tiny-label">
                  Owner {hosted.draft.ownerId}: {hosted.ownerActiveJobs}
                  {hosted.ownerJobLimit
                    ? ` / ${hosted.ownerJobLimit}`
                    : ""}{" "}
                  hosted slots in use
                </div>
                <div className={`hosted-status ${hosted.statusTone}`}>
                  {hosted.statusMessage ||
                    "Select an archetype to keep editing, then save the finished bot into your library."}
                </div>
                <div className="build-nav">
                  <span />
                  <button
                    type="button"
                    onClick={() => setBuildStep("controls")}
                  >
                    Next: Commands &rarr;
                  </button>
                </div>
              </div>
            )}

            {buildStep === "controls" && (
              <div className="build-section">
                <CommandControlsCard
                  profile={commandProfile}
                  onUpdateProfile={setCommandProfile}
                />
                <div className="build-nav">
                  <button
                    type="button"
                    className="ghost"
                    onClick={() => setBuildStep("archetype")}
                  >
                    &larr; Back
                  </button>
                  <button type="button" onClick={() => setBuildStep("draft")}>
                    Next: Prompt &rarr;
                  </button>
                </div>
              </div>
            )}

            {buildStep === "draft" && (
              <div className="build-section">
                <HostedDraftCard
                  draft={hosted.draft}
                  commandProfile={commandProfile}
                  isWorking={hosted.saveBuildMutation.isPending}
                  onResetDraft={hosted.resetDraft}
                  onStoreManifest={handleSaveAgent}
                  onUpdateDraft={hosted.updateDraft}
                />
                <div className="build-nav">
                  <button
                    type="button"
                    className="ghost"
                    onClick={() => setBuildStep("controls")}
                  >
                    &larr; Back
                  </button>
                  <button type="button" onClick={() => setBuildStep("preview")}>
                    Next: Review &amp; Save &rarr;
                  </button>
                </div>
              </div>
            )}

            {buildStep === "preview" && (
              <div className="build-section">
                {hasOverlay && (
                  <div className="command-overlay-preview">
                    <div className="small-label">
                      Commander Directives (auto-applied)
                    </div>
                    <pre className="overlay-text">
                      {overlay.policyAppend.trim()}
                      {overlay.styleAppend
                        ? "\n" + overlay.styleAppend.trim()
                        : ""}
                    </pre>
                  </div>
                )}

                <div className="build-launch-section">
                  <h3>Ready to Save</h3>
                  <p>
                    Your agent{" "}
                    <strong>
                      {hosted.draft.displayName ||
                        hosted.draft.heroName ||
                        "Unnamed"}
                    </strong>
                    {activeArchetypeId && (
                      <>
                        {" "}
                        using the <strong>{activeArchetypeId}</strong> archetype
                      </>
                    )}{" "}
                    is ready to be saved into your local bot library.
                  </p>

                  <div className={`hosted-status ${hosted.statusTone}`}>
                    {hosted.statusMessage}
                  </div>

                  <div className="hosted-toolbar">
                    <button
                      type="button"
                      disabled={hosted.saveBuildMutation.isPending}
                      onClick={handleSaveAgent}
                    >
                      Save Agent
                    </button>
                  </div>
                </div>

                <details
                  className="manifest-details"
                  open={manifestOpen}
                  onToggle={(e) =>
                    setManifestOpen((e.target as HTMLDetailsElement).open)
                  }
                >
                  <summary>Manifest JSON Preview</summary>
                  <HostedManifestPreview
                    manifestPreview={hosted.manifestPreview}
                  />
                </details>

                <div className="build-nav">
                  <button
                    type="button"
                    className="ghost"
                    onClick={() => setBuildStep("draft")}
                  >
                    &larr; Back
                  </button>
                  <span />
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      {/* ─── SAVED AGENTS TAB ─── */}
      {subTab === "saved" && (
        <div className="hosted-review">
          <RosterPanel
            currentDraft={hosted.draft}
            currentCommandProfile={commandProfile}
            currentArchetypeId={activeArchetypeId}
            onLoadBuild={(build) => {
              hosted.replaceDraft(build.draft);
              setCommandProfile(build.commandProfile);
              setActiveArchetypeId(build.archetypeId);
              setSubTab("build");
              setBuildStep("draft");
            }}
          />
        </div>
      )}
    </section>
  );
}

function isStepComplete(
  step: BuildStep,
  archetypeId: string | null,
  profile: CommandProfile,
): boolean {
  switch (step) {
    case "archetype":
      return archetypeId !== null;
    case "controls":
      return (
        profile.riskPosture !== DEFAULT_COMMAND_PROFILE.riskPosture ||
        profile.objectivePriority !==
          DEFAULT_COMMAND_PROFILE.objectivePriority ||
        profile.combatTolerance !== DEFAULT_COMMAND_PROFILE.combatTolerance ||
        profile.lootBias !== DEFAULT_COMMAND_PROFILE.lootBias ||
        profile.customRules.length > 0
      );
    default:
      return false;
  }
}
