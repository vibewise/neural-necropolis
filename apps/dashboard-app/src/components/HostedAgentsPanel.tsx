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
import { HostedConnectionCard } from "./hostedAgents/HostedConnectionCard";
import { HostedDraftCard } from "./hostedAgents/HostedDraftCard";
import { HostedJobsCard } from "./hostedAgents/HostedJobsCard";
import { HostedLogsCard } from "./hostedAgents/HostedLogsCard";
import { HostedManifestPreview } from "./hostedAgents/HostedManifestPreview";
import { HostedManifestsCard } from "./hostedAgents/HostedManifestsCard";
import { RosterPanel } from "./RosterPanel";

type HostedSubTab = "build" | "roster" | "review" | "settings";

type HostedAgentsPanelProps = {
  apiBase: string;
};

const BUILD_STEPS = [
  { key: "archetype", label: "1. Archetype" },
  { key: "controls", label: "2. Commands" },
  { key: "draft", label: "3. Prompt" },
  { key: "preview", label: "4. Preview & Launch" },
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

  function handleQuickLaunch(archetype: Archetype) {
    const nextDraft = applyArchetype(hosted.draft, archetype);
    setActiveArchetypeId(archetype.id);
    hosted.replaceDraft(nextDraft);
    hosted.launchJobMutation.mutate(nextDraft, {
      onSuccess: () => {
        setSubTab("review");
      },
    });
  }

  const overlay = buildCommandPolicyOverlay(commandProfile);
  const hasOverlay = Boolean(overlay.policyAppend || overlay.styleAppend);

  const subTabs: Array<[HostedSubTab, string]> = [
    ["build", "\uD83D\uDEE0 Build Agent"],
    ["roster", "\uD83D\uDEE1 Roster"],
    ["review", "\uD83D\uDCCB Review Agents"],
    ["settings", "\u2699\uFE0F Settings"],
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
                  isLaunching={hosted.launchJobMutation.isPending}
                  onQuickLaunchArchetype={handleQuickLaunch}
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
                    "Select an archetype to keep editing, or quick launch immediately with the default commander settings."}
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
                  isWorking={false}
                  onLaunchJob={() => {}}
                  onResetDraft={hosted.resetDraft}
                  onStoreManifest={() => {}}
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
                    Next: Preview &amp; Launch &rarr;
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
                  <h3>Ready to Launch</h3>
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
                    will connect to <strong>{apiBase}</strong>.
                  </p>

                  <div className={`hosted-status ${hosted.statusTone}`}>
                    {hosted.statusMessage}
                  </div>

                  <div className="hosted-toolbar">
                    <button
                      type="button"
                      disabled={
                        hosted.storeManifestMutation.isPending ||
                        hosted.launchJobMutation.isPending
                      }
                      onClick={() => hosted.launchJobMutation.mutate(undefined)}
                    >
                      {"\uD83D\uDE80"} Launch Hosted Agent
                    </button>
                    <button
                      type="button"
                      className="ghost"
                      disabled={hosted.storeManifestMutation.isPending}
                      onClick={() => hosted.storeManifestMutation.mutate()}
                    >
                      Store Manifest Only
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

      {/* ─── ROSTER TAB ─── */}
      {subTab === "roster" && (
        <div className="hosted-roster">
          <RosterPanel
            currentDraft={hosted.draft}
            currentCommandProfile={commandProfile}
            currentArchetypeId={activeArchetypeId}
            onLoadBuild={(build) => {
              // Apply loaded build to the draft
              for (const [key, value] of Object.entries(build.draft)) {
                hosted.updateDraft(
                  key as keyof typeof hosted.draft,
                  value as never,
                );
              }
              if (build.commandProfile) {
                setCommandProfile(build.commandProfile);
              }
              if (build.archetypeId) {
                setActiveArchetypeId(build.archetypeId);
              }
              setSubTab("build");
              setBuildStep("preview");
            }}
          />
        </div>
      )}

      {/* ─── REVIEW AGENTS TAB ─── */}
      {subTab === "review" && (
        <div className="hosted-review">
          <div className="hosted-grid">
            <HostedJobsCard
              isCancelling={hosted.cancelJobMutation.isPending}
              jobs={hosted.stateQuery.data?.jobs ?? []}
              selectedHostedJobId={hosted.selectedHostedJobId}
              onCancelJob={(jobId) => hosted.cancelJobMutation.mutate(jobId)}
              onSelectJob={(jobId) => {
                hosted.selectJob(jobId);
                void hosted.logsQuery.refetch();
              }}
            />

            <HostedManifestsCard
              manifests={hosted.stateQuery.data?.manifests ?? []}
            />

            <HostedLogsCard
              logs={hosted.logsQuery.data ?? []}
              selectedHostedJobId={hosted.selectedHostedJobId}
            />
          </div>
        </div>
      )}

      {/* ─── SETTINGS TAB ─── */}
      {subTab === "settings" && (
        <div className="hosted-settings">
          <HostedConnectionCard
            activeJobs={hosted.stateQuery.data?.health.activeJobs ?? 0}
            dataDir={hosted.stateQuery.data?.health.dataDir ?? ""}
            draftBase={hosted.draftBase}
            draftToken={hosted.draftToken}
            isClearing={hosted.purgeDataMutation.isPending}
            isError={hosted.stateQuery.isError}
            isLoading={hosted.stateQuery.isLoading}
            jobs={hosted.stateQuery.data?.health.jobs ?? 0}
            manifests={hosted.stateQuery.data?.health.manifests ?? 0}
            statusMessage={hosted.statusMessage}
            statusTone={hosted.statusTone}
            onClearHostedData={() => {
              if (
                window.confirm(
                  "Remove all stored hosted manifests, jobs, and logs from the current prompt-runner data directory?",
                )
              ) {
                hosted.purgeDataMutation.mutate();
              }
            }}
            onChangeBase={hosted.setDraftBase}
            onChangeToken={hosted.setDraftToken}
            onRefresh={() => void hosted.stateQuery.refetch()}
            onSaveConnection={hosted.saveConnection}
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
