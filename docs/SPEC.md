# Neural Necropolis Specification

> Where Dead Code Dreams of Vengeance

This document is the project-facing specification for running the game, understanding the public API, and building bots.

Gameplay rules are maintained in [GAME_MECHANICS.md](GAME_MECHANICS.md).

## Starting The Game

### Standard duel with predefined bots

```bash
npm install
npm run dev:duel
```

### Duel with AI bots

```bash
npm install
npm run dev:duel:aibot
```

This preset starts 10 AI bots. Boards still run with 4 heroes at a time, so the rest queue for later boards. The submit window is 8 seconds and the resolve window stays at 500ms. Each bot slot (A–J) reads its own provider, model alias, trait, and mission from the environment.

### Full local stack

```bash
npm install
npm run dev:all
```

Then open `http://localhost:3000`.

## Public API

| Method | Path                      | Purpose                                 |
| ------ | ------------------------- | --------------------------------------- |
| GET    | `/api/health`             | Beat timing and board status            |
| POST   | `/api/heroes/register`    | Register a hero                         |
| GET    | `/api/heroes/:id/observe` | Local vision, events, and legal actions |
| POST   | `/api/heroes/:id/act`     | Submit one action                       |
| POST   | `/api/heroes/:id/log`     | Add a bot message to the feed           |
| GET    | `/api/dashboard`          | Current dashboard snapshot              |
| GET    | `/api/boards`             | Board summaries                         |
| GET    | `/api/boards/completed`   | Paginated completed board history       |
| GET    | `/api/stream`             | Live updates                            |
| GET    | `/api/leaderboard`        | Score table                             |
| GET    | `/api/seed`               | Current seed                            |

## Bot Loop

Every bot follows the same high-level loop:

1. register a hero
2. observe the board state
3. choose one legal action
4. submit it during the submit window
5. repeat until the board ends

## Bot Types

There are two public bot categories:

- predefined bots: scripted personalities with fixed behavior patterns
- AI bots: model-driven bots that choose among legal actions at runtime

## AI Bot Guidance

An AI bot should:

1. inspect the current hero state
2. inspect nearby threats, rewards, and exits
3. inspect any remembered explored tiles if client-side memory is enabled
4. inspect legal actions
5. pick exactly one legal action
6. prefer survival when a high-value greedy play would likely fail

The built-in AI bot prompt currently includes:

- hero state
- local visible terrain as a compact minimap
- visible monsters, heroes, NPCs, and floor items
- recent events
- a compact tactical-priorities summary derived from the current observation
- optional client-side memory of previously explored tiles
- legal actions

## Bot Configuration

AI bot configuration has three layers:

1. **Providers** — `DEFAULT_PROVIDER` selects the default. Per-provider API keys and optional base-URL overrides use `<PROVIDER>_API_KEY` and `<PROVIDER>_BASE_URL`. Known OpenAI-compatible providers (openai, groq, together, fireworks, perplexity, ollama) have built-in URLs.
2. **Model presets** — `MODEL_<ALIAS>_ID` maps an alias to the actual model identifier. Per-model settings: `_TEMPERATURE`, `_MAX_COMPLETION_TOKENS`, `_INCLUDE_REASONING`, `_REASONING_EFFORT`.
3. **Bot slots (A–J)** — `AIBOT_<SLOT>_PROVIDER`, `AIBOT_<SLOT>_MODEL`, `AIBOT_<SLOT>_TRAIT`, `AIBOT_<SLOT>_MISSION`, `AIBOT_<SLOT>_INCLUDE_EXPLORED_MEMORY`.

Bot display name is auto-derived as `<Provider>-<ModelAlias>-<Slot>`.

## Observations

An observation returns the information a hero is allowed to know at that moment, including:

- hero state
- visible terrain
- visible monsters
- visible heroes
- visible non-hostile characters
- visible floor items
- recent events
- legal actions

Legal actions are authoritative. Bots should choose from them rather than guessing what is valid.

## Action Submission Rule

A hero may have one submitted action per turn. Once a valid action is queued for that hero, additional submissions in the same turn are rejected.

## Environment Notes

Useful runtime settings include:

- host and port
- submit window duration
- resolve window duration
- maximum board length
- warm-up before boards auto-start
- `AIBOT_<SLOT>_INCLUDE_EXPLORED_MEMORY` to enable or disable client-side explored-tile memory per slot

See `.env.example` for the full list of provider, model, and slot settings.

## Game Settings (Admin)

The server exposes global **game settings** via `GET/POST /api/admin/settings`. These affect all bots equally:

| Setting                  | Default | Description                                                              |
| ------------------------ | ------- | ------------------------------------------------------------------------ |
| `paused`                 | `true`  | Server starts paused. Controlled by the dashboard on/off toggle.         |
| `includeLandmarks`       | `false` | When enabled, observations include up to 10 deterministic map landmarks. |
| `includePlayerPositions` | `false` | When enabled, observations include every living hero's position.         |

The dashboard header has a **Turns ON / Turns OFF** toggle switch. The Settings tab provides Mode A/B (landmark toggle) and Mode C (player positions) controls.

See [GAME_MECHANICS.md §8a](GAME_MECHANICS.md) for gameplay implications.

## Product Positioning

Neural Necropolis is intended to support:

- local bot-vs-bot experimentation
- AI bot prototyping
- seeded comparative runs
- live spectating through the dashboard

For gameplay details such as combat rules, movement consequences, score sources, fatigue, morale, monster behavior, and board lifecycle, see [GAME_MECHANICS.md](GAME_MECHANICS.md).
