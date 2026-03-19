# Neural Necropolis

> Where Dead Code Dreams of Vengeance

Neural Necropolis is a beat-based dungeon arena where predefined bots and AI bots explore, fight, loot, and escape across procedurally generated dungeon boards. Every run is a live competition between survival, greed, route planning, and combat timing.

## License

This project is released under the MIT License. See [LICENSE](LICENSE).

## How To Start The Game

### 1. Install dependencies

```bash
npm install
```

### 2. Start the engine and sample bots

```bash
npm run dev:duel
```

This starts the game engine plus a roster of predefined bots.

By default the server starts with turns paused. Use the dashboard's `Turns ON` toggle to enable normal auto-start behavior.

Once turns are on, a board auto-starts only when all of these are true:

- no other board is currently running
- at least 4 heroes are attached to the open board
- any configured `BOARD_WARMUP_MS` delay has expired

If port `3000` is already used on your machine, set a different port once and use the same value for bots/runner:

```bash
npx cross-env PORT=3002 MMORPH_SERVER_URL=http://127.0.0.1:3002 npm run dev:duel
```

### 3. Open the dashboard

Open [http://localhost:3000](http://localhost:3000) in a browser (or your chosen `PORT`).

You will see:

- the active dungeon board
- queued and completed boards
- per-bot panels and feeds
- the live event stream

## Other Useful Start Commands

```bash
npm run engine
npm run dev:runner
npm run dev:bot:berserker
npm run dev:bot:explorer
npm run dev:bot:treasure
npm run dev:bot:aibot
npm run dev:duel:aibot
npm run dev:all
```

What they do:

- `npm run engine`: start only the game engine
- `npm run dev:runner`: start the status monitor
- `npm run dev:bot:berserker`: run one predefined berserker bot
- `npm run dev:bot:explorer`: run one predefined explorer bot
- `npm run dev:bot:treasure`: run one predefined treasure-hunter bot
- `npm run dev:bot:aibot`: run one AI bot using slot A by default
- `npm run dev:duel:aibot`: run the engine plus 10 AI bots (slots A–J); 4 bots play per board, the submit window is 8 seconds; each slot reads its own provider, model, trait, and mission from the environment
- `npm run dev:all`: run the engine, runner, predefined bots, and one AI bot together

The dashboard uses a `Turns ON` / `Turns OFF` toggle. `Turns ON` resumes normal auto-start rules; it does not force-start underfilled boards.

## Cross-Platform Notes (Linux + Windows)

- Scripts are shell-agnostic and work in both Linux and Windows terminals.
- Use env overrides with `cross-env` when you need a non-default port.
- For local runs, `PORT` is the source of truth; if `MMORPH_SERVER_URL` points to localhost/127.0.0.1, clients automatically align to `PORT`.
- Recommended generic pattern:

```bash
npx cross-env PORT=3002 MMORPH_SERVER_URL=http://127.0.0.1:3002 npm run dev:all
```

## What The Game Is

- turn-based but paced in real time through repeating beat windows
- multi-board, so one board can be running while others wait or finish
- deterministic per seed, making runs comparable
- built around legal-action selection rather than free-form command input

## Bots

There are two broad bot styles:

- predefined bots: scripted personalities such as berserker, explorer, and treasure hunter
- AI bots: model-driven agents that choose from the legal action list each turn

AI bots currently receive local vision, authoritative legal actions, a compact tactical-priorities summary, and optional remembered explored tiles accumulated from prior observations.

Bot configuration uses three layers defined in `.env`:

1. **Providers** — `DEFAULT_PROVIDER`, `<PROVIDER>_API_KEY`, optional `<PROVIDER>_BASE_URL` override. Known OpenAI-compatible providers have built-in URLs (openai, groq, together, fireworks, perplexity, ollama). Anthropic and Google Gemini are not OpenAI-compatible.
2. **Model presets** — `MODEL_<ALIAS>_ID` plus per-model tuning (`_TEMPERATURE`, `_MAX_COMPLETION_TOKENS`, `_INCLUDE_REASONING`, `_REASONING_EFFORT`).
3. **Bot slots (A–J)** — `AIBOT_<SLOT>_PROVIDER`, `AIBOT_<SLOT>_MODEL` (alias), `AIBOT_<SLOT>_TRAIT`, `AIBOT_<SLOT>_MISSION`, `AIBOT_<SLOT>_INCLUDE_EXPLORED_MEMORY`.

The bot display name is auto-derived as `<Provider>-<ModelAlias>-<Slot>` (e.g. `Groq-Llama70-A`).

When explored-memory is enabled, the bot keeps a client-side memory of previously seen tiles and includes a compact remembered-tile summary in later prompts. This does not grant omniscient map access; the live observation remains local vision only.

## Rules And Mechanics

Game rules are documented in [docs/GAME_MECHANICS.md](docs/GAME_MECHANICS.md).

That document is the canonical gameplay reference and is intentionally written in game-design terms rather than implementation details.

## API Summary

| Method | Path                      | Purpose                                 |
| ------ | ------------------------- | --------------------------------------- |
| GET    | `/api/health`             | Current beat and board timing           |
| POST   | `/api/heroes/register`    | Register a hero                         |
| GET    | `/api/heroes/:id/observe` | Retrieve local vision and legal actions |
| POST   | `/api/heroes/:id/act`     | Submit one action for the current turn  |
| GET    | `/api/dashboard`          | Full board snapshot for the UI          |
| GET    | `/api/stream`             | Live server-sent updates                |
| GET    | `/api/leaderboard`        | Current score table                     |
| GET    | `/api/seed`               | Current seed                            |

## Building Your Own Bot

1. Register a hero.
2. Observe the current board state.
3. Read the legal actions for that hero.
4. Choose exactly one action.
5. Submit it before the submit window ends.

For gameplay behavior and scoring priorities, use [docs/GAME_MECHANICS.md](docs/GAME_MECHANICS.md).
