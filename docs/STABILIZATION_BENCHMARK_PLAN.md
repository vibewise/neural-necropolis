# Stabilization And Benchmark Plan

This file is a concrete execution plan for stabilizing the current game state without adding gameplay features.

## Scope

- Do not add new gameplay mechanics.
- Stabilize the current bot/runtime and benchmark paths.
- Make a 10-duel GPT-4o-mini vs Groq Llama 70B benchmark reproducible and auditable.

## Immediate Acceptance Criteria

1. A repeated duel can run on the same board seed every time.
2. Seat order alternates between the two models across 10 duels.
3. The benchmark path uses real provider-backed bots, not arena heuristics.
4. Spell actions remain faithful when selected by a model.
5. Reasoning and output token settings are actually forwarded to the provider.
6. Each duel produces a machine-readable result summary.

## Execution Prompts

Use these prompts as separate implementation steps.

### Prompt 1: Fix Prompt-Runner Action Fidelity

```text
Fix the hosted prompt-runner action matching so cast_spell selections preserve spellKind instead of collapsing to the first cast_spell legal action. Add a regression test that proves a selected locate_monsters action stays locate_monsters when multiple spell actions are legal.
```

Target files:

- apps/prompt-runner/src/worker.ts
- apps/prompt-runner/test/index.test.mts

### Prompt 2: Fix Prompt-Runner Reasoning Controls

```text
Fix the hosted prompt-runner model request so reasoningEffort is forwarded to the provider request when configured. Add a regression test that captures the outgoing OpenAI-compatible request body and verifies reasoning_effort is present.
```

Target files:

- apps/prompt-runner/src/model.ts
- apps/prompt-runner/test/index.test.mts

### Prompt 3: Make Board Seeding Reproducible

```text
Implement deterministic board creation support driven by DUNGEON_SEED so repeated server resets can create the same board layout without changing the normal default behavior when DUNGEON_SEED is unset. Add a focused engine test for the fixed-seed path.
```

Target files:

- engine/game/manager.go
- engine/server/server.go
- engine/game/manager_test.go

### Prompt 4: Build A Trustworthy Duel Harness

```text
Create a script that runs a 10-duel benchmark between two local AI bot slots against the engine using the same DUNGEON_SEED each duel, alternating bot registration order each run so positions swap fairly. The script should capture per-duel board id, seed, spawn order, top leaderboard, and a final aggregate summary.
```

Target files:

- scripts/run-llm-duel-benchmark.mjs
- README.md or docs/QUICKSTART.md if usage needs documenting

### Prompt 5: Post-Benchmark Verification

```text
Review the duel benchmark outputs and confirm: same seed across all duels, alternating registration order, two heroes attached before start, and consistent provider/model labeling in the final report. Document any remaining nondeterminism or result interpretation risks.
```

## Recommended Order

1. Prompt-runner action fidelity
2. Prompt-runner reasoning controls
3. Fixed-seed board support
4. Duel harness script
5. Post-benchmark verification

## Deferred Work (Phase 1 — Bypass Arena)

These were real issues identified during the initial audit, deferred because the Phase 1 benchmark used a direct duel harness instead of arena mode.

- Fix arena standings attribution in engine/game/arena.go.
- Replace heuristic-only arena execution with real provider-backed bot execution.
- Honor playersPerDuel in arena scheduling and execution.
- Improve source dashboard arena UX to expose seat rotation and duel audit details.

---

## Phase 2 — UI-Driven Arena With Real LLM Bots

### Gap Analysis

The Phase 1 benchmark scripts bypass the dashboard and arena entirely. The user's end-state vision is:

1. Start the game server.
2. Start the prompt runner (optional, for external hosted agents).
3. Configure an arena for 2 bots entirely via the dashboard UI, including bot types (berserker, etc.) and arena specifics (duel count, max turns).
4. The bots play using real OpenAI / Groq (or any OpenAI-compatible provider) API calls.
5. Timing: ~2 s submit window, ~0.5 s resolve window.
6. Token limits are sensible and not artificially restrictive; token usage statistics are measured and displayed on screen.

### Identified Gaps (vs Current State)

| #   | Gap                                                    | Severity    | Detail                                                                                                                                                                        |
| --- | ------------------------------------------------------ | ----------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| A   | Arena uses heuristic bots, not LLMs                    | **BLOCKER** | `chooseArenaBotAction()` in `engine/server/arena.go` is 100 % scripted Go logic. Provider and model fields on `ArenaBotConfig` are stored but never used to call any LLM API. |
| B   | Arena bot config has no LLM tuning fields              | Medium      | `ArenaBotConfig` only has `label / provider / model / strategy`. No `maxOutputTokens`, `temperature`, or `reasoningEffort`.                                                   |
| C   | Submit window too short for real LLM round-trips       | Low         | Default is 12 s (fine), but 2 s is tight for OpenAI (~1-5 s). Groq is typically faster. The submit window should serve as the LLM call timeout.                               |
| D   | No token usage tracking anywhere                       | Medium      | Neither the engine, the prompt-runner, nor the ai-bots runtime record prompt/completion tokens.                                                                               |
| E   | Dashboard has no token statistics display              | Medium      | Standings show wins / duels / score but zero LLM cost or token information.                                                                                                   |
| F   | `maxOutputTokens` not configurable per bot in arena UI | Low         | The ArenaCreator bot card only exposes provider/model/strategy.                                                                                                               |

### Implementation Plan — Phase 2

All items execute inside the Go engine so the arena remains self-contained (no dependency on the prompt-runner being alive).

#### Item A — Embed LLM Client in Arena

Create `engine/server/arena_llm.go`:

- OpenAI-compatible HTTP client (`/v1/chat/completions`)
- Provider URL + API key resolution from env (`OPENAI_API_KEY`, `GROQ_API_KEY`, etc.)
- Prompt builder: system prompt (game rules + strategy) and user prompt (hero state + legal actions) from `VisionData`
- Response parser: extract `ACTION: <index>` from completion text
- Fallback: if LLM call fails or times out, fall back to existing heuristic

Modify `engine/server/arena.go`:

- `submitArenaBotActions` launches all LLM calls concurrently
- Each call gets a timeout of `planningMs - 200 ms` (leave buffer for submission)
- On timeout or error, degrade gracefully to heuristic choice

#### Item B — Extend ArenaBotConfig

Add to `ArenaBotConfig` in `engine/game/arena.go`:

- `MaxOutputTokens int` (JSON `maxOutputTokens`, default 300)
- `Temperature float64` (JSON `temperature`, default 0.7)
- `ReasoningEffort string` (JSON `reasoningEffort`, optional)

Mirror in `packages/protocol-ts/src/index.ts` and `apps/dashboard-app`.

#### Item C — Adaptive Submit Timing

The arena duel loop already uses `s.planningMs`. After concurrent LLM submissions, only sleep for the _remaining_ submit window (if any). UI Operator Controls already let the user set submit/resolve windows.

#### Item D — Token Usage Tracking

Add `DuelHeroTokenStats` struct to `engine/game/arena.go`:

- Per-hero per-duel: `promptTokens`, `completionTokens`, `totalTokens`, `llmCalls`, `fallbacks`

Track in `heroTokenAccum` map during duel execution. Store in `DuelResult.TokenStats`. Aggregate into `ArenaBotStanding` totals.

#### Item E — Dashboard Token Stats

Extend `StandingsTable` to show token columns (prompt / completion / calls). Extend `FocusDetailPanel` bot section to show token aggregates.

#### Item F — maxOutputTokens in Arena UI

Add temperature, maxOutputTokens, and reasoningEffort inputs to the ArenaCreator bot card advanced panel.
