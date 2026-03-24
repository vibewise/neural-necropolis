import { useCallback, useState } from "react";
import type {
  ArenaBotConfig,
  ArenaSnapshot,
  ArenaBotStanding,
  ArenaMatchSnapshot,
  DuelResult,
} from "../api";
import { useArena } from "../hooks/useArena";

// ── Known providers & popular models ──

const KNOWN_PROVIDERS = [
  { value: "openai", label: "OpenAI" },
  { value: "groq", label: "Groq" },
  { value: "together", label: "Together AI" },
  { value: "anthropic", label: "Anthropic" },
  { value: "google", label: "Google" },
  { value: "mistral", label: "Mistral" },
  { value: "deepseek", label: "DeepSeek" },
  { value: "fireworks", label: "Fireworks AI" },
];

const POPULAR_MODELS: Record<
  string,
  Array<{ value: string; label: string }>
> = {
  openai: [
    { value: "gpt-4o", label: "GPT-4o" },
    { value: "gpt-4o-mini", label: "GPT-4o Mini" },
    { value: "o3-mini", label: "o3-mini" },
    { value: "gpt-4-turbo", label: "GPT-4 Turbo" },
  ],
  groq: [
    { value: "llama-3.3-70b-versatile", label: "Llama 3.3 70B" },
    { value: "qwen-qwq-32b", label: "QwQ 32B" },
    { value: "gemma2-9b-it", label: "Gemma 2 9B" },
    { value: "mixtral-8x7b-32768", label: "Mixtral 8x7B" },
  ],
  together: [
    {
      value: "meta-llama/Llama-3.3-70B-Instruct-Turbo",
      label: "Llama 3.3 70B",
    },
    { value: "Qwen/Qwen2.5-72B-Instruct-Turbo", label: "Qwen 2.5 72B" },
    { value: "mistralai/Mixtral-8x22B-Instruct-v0.1", label: "Mixtral 8x22B" },
  ],
  anthropic: [
    { value: "claude-sonnet-4-20250514", label: "Claude Sonnet 4" },
    { value: "claude-3-5-haiku-20241022", label: "Claude 3.5 Haiku" },
  ],
  google: [
    { value: "gemini-2.0-flash", label: "Gemini 2.0 Flash" },
    { value: "gemini-1.5-pro", label: "Gemini 1.5 Pro" },
  ],
  mistral: [
    { value: "mistral-large-latest", label: "Mistral Large" },
    { value: "mistral-small-latest", label: "Mistral Small" },
  ],
  deepseek: [
    { value: "deepseek-chat", label: "DeepSeek Chat (V3)" },
    { value: "deepseek-reasoner", label: "DeepSeek Reasoner (R1)" },
  ],
  fireworks: [
    {
      value: "accounts/fireworks/models/llama-v3p3-70b-instruct",
      label: "Llama 3.3 70B",
    },
  ],
};

type ArenaCreatorProps = {
  adminToken: string;
  onSubmit: (req: {
    name: string;
    bots: ArenaBotConfig[];
    playersPerDuel?: number;
  }) => void;
  busy: boolean;
};

function ArenaCreator({ adminToken, onSubmit, busy }: ArenaCreatorProps) {
  const [name, setName] = useState("LLM Arena");
  const [bots, setBots] = useState<ArenaBotConfig[]>([
    {
      label: "Bot A",
      provider: "openai",
      model: "gpt-4o",
      strategy: "berserker",
    },
    {
      label: "Bot B",
      provider: "groq",
      model: "llama-3.3-70b-versatile",
      strategy: "berserker",
    },
  ]);

  const updateBot = useCallback(
    (index: number, field: keyof ArenaBotConfig, value: string) => {
      setBots((prev) => {
        const next = [...prev];
        next[index] = { ...next[index], [field]: value };
        return next;
      });
    },
    [],
  );

  const addBot = useCallback(() => {
    const letter = String.fromCharCode(65 + bots.length);
    setBots((prev) => [
      ...prev,
      {
        label: `Bot ${letter}`,
        provider: "openai",
        model: "gpt-4o",
        strategy: "berserker",
      },
    ]);
  }, [bots.length]);

  const removeBot = useCallback((index: number) => {
    setBots((prev) => prev.filter((_, i) => i !== index));
  }, []);

  const handleSubmit = useCallback(() => {
    if (!name.trim() || bots.length < 2) return;
    onSubmit({ name: name.trim(), bots });
  }, [name, bots, onSubmit]);

  return (
    <div className="operator-card">
      <h3>Create Arena</h3>
      <label className="field">
        <span>Arena Name</span>
        <input
          type="text"
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="LLM Arena"
        />
      </label>

      <div className="arena-bots-list">
        <h4>
          Bots ({bots.length}){" "}
          <button type="button" className="ghost small" onClick={addBot}>
            + Add Bot
          </button>
        </h4>
        {bots.map((bot, i) => (
          <div key={i} className="arena-bot-row">
            <input
              type="text"
              className="arena-bot-label"
              value={bot.label}
              onChange={(e) => updateBot(i, "label", e.target.value)}
              placeholder="Bot label"
            />
            <select
              className="arena-bot-provider"
              value={bot.provider}
              onChange={(e) => {
                updateBot(i, "provider", e.target.value);
                const models = POPULAR_MODELS[e.target.value];
                if (models?.[0]) {
                  updateBot(i, "model", models[0].value);
                }
              }}
            >
              {KNOWN_PROVIDERS.map((p) => (
                <option key={p.value} value={p.value}>
                  {p.label}
                </option>
              ))}
            </select>
            <select
              className="arena-bot-model"
              value={
                POPULAR_MODELS[bot.provider]?.some((m) => m.value === bot.model)
                  ? bot.model
                  : "__custom"
              }
              onChange={(e) => {
                if (e.target.value !== "__custom") {
                  updateBot(i, "model", e.target.value);
                }
              }}
            >
              {(POPULAR_MODELS[bot.provider] ?? []).map((m) => (
                <option key={m.value} value={m.value}>
                  {m.label}
                </option>
              ))}
              <option value="__custom">Custom...</option>
            </select>
            {(!POPULAR_MODELS[bot.provider]?.some(
              (m) => m.value === bot.model,
            ) ||
              false) && (
              <input
                type="text"
                className="arena-bot-model-custom"
                value={bot.model}
                onChange={(e) => updateBot(i, "model", e.target.value)}
                placeholder="model-id"
              />
            )}
            {bots.length > 2 && (
              <button
                type="button"
                className="ghost small danger"
                onClick={() => removeBot(i)}
              >
                ×
              </button>
            )}
          </div>
        ))}
      </div>

      <div className="button-row tight">
        <button
          type="button"
          disabled={!adminToken || busy || bots.length < 2 || !name.trim()}
          onClick={handleSubmit}
        >
          Create Arena
        </button>
      </div>
      {!adminToken && (
        <div className="operator-readout">
          Save an admin token in Settings to create arenas.
        </div>
      )}
    </div>
  );
}

// ── Match config ──

type MatchConfigProps = {
  adminToken: string;
  arenaStatus: string;
  onAddMatch: (req: { duelCount: number; maxTurns: number }) => void;
  onStart: () => void;
  busy: boolean;
  matchCount: number;
};

function MatchConfigurator({
  adminToken,
  arenaStatus,
  onAddMatch,
  onStart,
  busy,
  matchCount,
}: MatchConfigProps) {
  const [duelCount, setDuelCount] = useState(10);
  const [maxTurns, setMaxTurns] = useState(100);

  let actionHint = "Create an even-numbered match, then start the arena.";
  if (!adminToken) {
    actionHint =
      "Save an admin token in Settings to add matches and start arenas.";
  } else if (arenaStatus !== "pending") {
    actionHint =
      "This arena has already started. Create a new arena for another run.";
  } else if (matchCount === 0) {
    actionHint = "Add at least one match before starting the arena.";
  } else if (duelCount % 2 !== 0) {
    actionHint =
      "Duel count must stay even so bots rotate through the same spawn positions fairly.";
  } else {
    actionHint =
      "Arena is ready. Press Start Arena to kick off the duel queue.";
  }

  const handleAddMatch = useCallback(() => {
    if (duelCount < 2 || duelCount % 2 !== 0) return;
    onAddMatch({ duelCount, maxTurns: maxTurns > 0 ? maxTurns : 100 });
  }, [duelCount, maxTurns, onAddMatch]);

  return (
    <div className="operator-card">
      <h3>Match Configuration</h3>
      <div className="field-grid compact-fields">
        <label className="field">
          <span>Duels per Match (even number)</span>
          <input
            type="number"
            min={2}
            step={2}
            value={duelCount}
            onChange={(e) => {
              const val = Number(e.target.value || 2);
              setDuelCount(val % 2 === 0 ? val : val + 1);
            }}
          />
        </label>
        <label className="field">
          <span>Max Turns per Duel</span>
          <input
            type="number"
            min={10}
            value={maxTurns}
            onChange={(e) => setMaxTurns(Number(e.target.value || 100))}
          />
        </label>
      </div>
      <div className="button-row tight">
        <button
          type="button"
          disabled={
            !adminToken ||
            busy ||
            duelCount < 2 ||
            duelCount % 2 !== 0 ||
            arenaStatus !== "pending"
          }
          onClick={handleAddMatch}
        >
          Add Match
        </button>
        <button
          type="button"
          disabled={
            !adminToken || busy || arenaStatus !== "pending" || matchCount === 0
          }
          onClick={onStart}
        >
          Start Arena
        </button>
      </div>
      {duelCount % 2 !== 0 && duelCount >= 2 && (
        <div className="operator-readout">
          Duel count must be even so every bot gets each spawn position equally.
        </div>
      )}
      <div className="operator-readout">{actionHint}</div>
    </div>
  );
}

// ── Standings table ──

function StandingsTable({ standings }: { standings: ArenaBotStanding[] }) {
  const sorted = [...standings].sort(
    (a, b) => b.wins - a.wins || b.totalScore - a.totalScore,
  );

  return (
    <div className="operator-card operator-span">
      <h3>Standings</h3>
      <table className="arena-table">
        <thead>
          <tr>
            <th>#</th>
            <th>Bot</th>
            <th>Provider / Model</th>
            <th>Wins</th>
            <th>Duels</th>
            <th>Total Score</th>
            <th>Avg Score</th>
          </tr>
        </thead>
        <tbody>
          {sorted.map((s, i) => (
            <tr key={s.botIndex}>
              <td>{i + 1}</td>
              <td>
                <strong>{s.label}</strong>
              </td>
              <td>
                {s.provider} / {s.model}
              </td>
              <td>{s.wins}</td>
              <td>{s.duelsPlayed}</td>
              <td>
                {s.duelsPlayed > 0
                  ? `${((s.wins / s.duelsPlayed) * 100).toFixed(1)}%`
                  : "—"}
              </td>
              <td>{s.totalScore}</td>
              <td>
                {s.duelsPlayed > 0
                  ? (s.totalScore / s.duelsPlayed).toFixed(1)
                  : "—"}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// ── Match list ──

function MatchList({ matches }: { matches: ArenaMatchSnapshot[] }) {
  const [expandedMatch, setExpandedMatch] = useState<string | null>(null);

  return (
    <div className="operator-card operator-span">
      <h3>Matches ({matches.length})</h3>
      {matches.map((match) => {
        const completedDuels = match.duels.filter(
          (d) => d.status === "complete",
        ).length;
        const isExpanded = expandedMatch === match.id;
        return (
          <div key={match.id} className="arena-match-block">
            <div
              className="arena-match-header"
              onClick={() => setExpandedMatch(isExpanded ? null : match.id)}
            >
              <span className={`arena-status-badge ${match.status}`}>
                {match.status}
              </span>
              <span>
                Seed: <code>{match.seed.slice(0, 12)}...</code>
              </span>
              <span>
                {completedDuels}/{match.duelCount} duels
              </span>
              <span>{match.maxTurns} turns/duel</span>
              <span className="expand-arrow">{isExpanded ? "▼" : "▶"}</span>
            </div>
            {isExpanded && (
              <div className="arena-duels-grid">
                {match.duels.map((duel) => (
                  <DuelCard key={duel.duelIndex} duel={duel} />
                ))}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

function DuelCard({ duel }: { duel: DuelResult }) {
  const winner =
    duel.status === "complete" && duel.leaderboard.length > 0
      ? duel.leaderboard[0]
      : null;

  return (
    <div className={`arena-duel-card ${duel.status}`}>
      <div className="duel-header">
        <span>Duel #{duel.duelIndex + 1}</span>
        <span className={`arena-status-badge ${duel.status}`}>
          {duel.status}
        </span>
      </div>
      {duel.status === "complete" && (
        <div className="duel-result">
          <span className="duel-winner">
            {winner ? `${winner.heroName}: ${winner.totalScore} pts` : "—"}
          </span>
          <span className="duel-turns">{duel.turnReached} turns</span>
        </div>
      )}
      {duel.status === "running" && (
        <div className="duel-result">
          <span className="duel-running-label">In progress...</span>
        </div>
      )}
    </div>
  );
}

// ── Arena selector ──

type ArenaSelectorProps = {
  arenas: Array<{
    id: string;
    name: string;
    status: string;
    botCount: number;
    matchCount: number;
  }>;
  selectedId: string | null;
  onSelect: (id: string | null) => void;
};

function ArenaSelector({ arenas, selectedId, onSelect }: ArenaSelectorProps) {
  if (arenas.length === 0) {
    return (
      <div className="operator-readout">
        No arenas yet. Create one to get started.
      </div>
    );
  }

  return (
    <div className="arena-selector">
      {arenas.map((a) => (
        <button
          key={a.id}
          type="button"
          className={`arena-selector-btn ${a.id === selectedId ? "active" : ""}`}
          onClick={() => onSelect(a.id === selectedId ? null : a.id)}
        >
          <span className={`arena-status-badge ${a.status}`}>{a.status}</span>
          <strong>{a.name}</strong>
          <span className="arena-meta">
            {a.botCount} bots · {a.matchCount} matches
          </span>
        </button>
      ))}
    </div>
  );
}

// ── Main panel ──

type ArenaModePanelProps = {
  apiBase: string;
};

export function ArenaModePanel({ apiBase }: ArenaModePanelProps) {
  const arena = useArena({ apiBase });

  const handleCreate = useCallback(
    (req: {
      name: string;
      bots: ArenaBotConfig[];
      playersPerDuel?: number;
    }) => {
      arena.createArenaMutation.mutate(req);
    },
    [arena.createArenaMutation],
  );

  const handleAddMatch = useCallback(
    (req: { duelCount: number; maxTurns: number }) => {
      arena.addMatchMutation.mutate(req);
    },
    [arena.addMatchMutation],
  );

  const handleStart = useCallback(() => {
    arena.startArenaMutation.mutate();
  }, [arena.startArenaMutation]);

  const detail = arena.arenaDetail;
  const isBusy =
    arena.createArenaMutation.isPending ||
    arena.addMatchMutation.isPending ||
    arena.startArenaMutation.isPending;
  const hasArenaList = arena.arenas.length > 0;
  const needsArenaSelection = hasArenaList && !arena.selectedArenaId;

  return (
    <section className="panel arena-panel">
      <h2>⚔ Arena Mode</h2>
      <p>
        Pit LLMs against each other under identical conditions. Create an arena,
        pick providers and models for each bot, add matches (sets of duels on
        the same board seed), then start. Results accumulate into standings for
        statistical comparison.
      </p>
      <div className="arena-instructions">
        <h3>How To Start</h3>
        <ol>
          <li>Save an admin token in Settings.</li>
          <li>Create an arena and choose the provider/model for each bot.</li>
          <li>Select the arena in Your Arenas.</li>
          <li>
            Add at least one match with an even duel count. Default max turns is
            100.
          </li>
          <li>Press Start Arena in Match Configuration.</li>
        </ol>
      </div>

      <div className="operator-grid">
        <ArenaCreator
          adminToken={arena.adminToken}
          onSubmit={handleCreate}
          busy={isBusy}
        />

        <div className="operator-card">
          <h3>Your Arenas</h3>
          <div className="operator-readout">
            Selecting an arena reveals Match Configuration and the Start Arena
            action.
          </div>
          <ArenaSelector
            arenas={arena.arenas}
            selectedId={arena.selectedArenaId}
            onSelect={arena.setSelectedArenaId}
          />
        </div>
      </div>

      {needsArenaSelection && (
        <div className="operator-readout arena-selection-hint">
          Select an arena from Your Arenas to add a match and start the run.
        </div>
      )}

      {detail && (
        <div className="operator-grid">
          <MatchConfigurator
            adminToken={arena.adminToken}
            arenaStatus={detail.status}
            onAddMatch={handleAddMatch}
            onStart={handleStart}
            busy={isBusy}
            matchCount={detail.matches.length}
          />

          {detail.standings.length > 0 && (
            <StandingsTable standings={detail.standings} />
          )}

          {detail.matches.length > 0 && <MatchList matches={detail.matches} />}
        </div>
      )}
    </section>
  );
}
