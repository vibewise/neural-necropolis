import { useState } from "react";

import type { DashboardResponse } from "../api";
import type { BoardSummary } from "@neural-necropolis/protocol-ts";
import { buildLauncherState } from "../dashboardModel";

type LauncherPanelProps = {
  apiBase: string;
  boards: BoardSummary[];
  compact?: boolean;
  healthOk: boolean;
  snapshot: DashboardResponse | null;
};

type CommandPreset = {
  id: string;
  title: string;
  description: string;
  command: string;
};

export function LauncherPanel(props: LauncherPanelProps) {
  const { apiBase, boards, compact = false, healthOk, snapshot } = props;
  const launcher = buildLauncherState({
    boards,
    serverReachable: healthOk,
    snapshot,
  });
  const [copiedId, setCopiedId] = useState<string | null>(null);

  const presets: CommandPreset[] = [
    {
      id: "engine",
      title: "Start local server",
      description:
        "Authoritative engine only. Open the dashboard after it starts.",
      command: "npm run run:engine",
    },
    {
      id: "demo-local",
      title: "Quick local demo",
      description: "Starts the server and a small scripted bot mix.",
      command: "npm run run:demo:local",
    },
    {
      id: "scripted",
      title: "Attach scripted bot",
      description: "Fastest single-hero client path against the local server.",
      command: `npx cross-env NEURAL_NECROPOLIS_SERVER_URL=${apiBase} npm run run:scripted:bot:berserker`,
    },
    {
      id: "openclaw",
      title: "Attach OpenClaw worker",
      description: "Persistent autonomous worker against the local server.",
      command: `npx cross-env NEURAL_NECROPOLIS_SERVER_URL=${apiBase} OPENCLAW_AGENT_LOCAL=1 npm run run:openclaw:bot -- --session crypt-ash --slug crypt-ash --persona scout`,
    },
    {
      id: "prompt-runner",
      title: "Hosted prompt demo",
      description:
        "Starts the server and prompt runner, uploads the manifest, and launches the hosted job automatically.",
      command: "npm run run:demo:prompt-runner -- --auto",
    },
  ];

  async function copyCommand(id: string, command: string) {
    await navigator.clipboard.writeText(command);
    setCopiedId(id);
    window.setTimeout(() => {
      setCopiedId((current) => (current === id ? null : current));
    }, 1200);
  }

  return (
    <section className={`panel launcher-panel${compact ? " compact" : ""}`}>
      <div className="launcher-head">
        <div>
          <p className="eyebrow">Phase 3 First-Run Launcher</p>
          <h2>{launcher.headline}</h2>
          <p>{launcher.nextAction}</p>
        </div>
        <div className="launcher-server-pill">{apiBase}</div>
      </div>

      <div className="launcher-checklist">
        {launcher.checklist.map((item) => (
          <article key={item.label} className={`launcher-check ${item.state}`}>
            <strong>{item.label}</strong>
            <span>{item.detail}</span>
          </article>
        ))}
      </div>

      {!compact ? (
        <div className="launcher-command-grid">
          {presets.map((preset) => (
            <article key={preset.id} className="launcher-command-card">
              <div className="launcher-command-head">
                <strong>{preset.title}</strong>
                <button
                  type="button"
                  className="ghost"
                  onClick={() => void copyCommand(preset.id, preset.command)}
                >
                  {copiedId === preset.id ? "Copied" : "Copy"}
                </button>
              </div>
              <p>{preset.description}</p>
              <code className="launcher-command-code">{preset.command}</code>
            </article>
          ))}
        </div>
      ) : null}
    </section>
  );
}
