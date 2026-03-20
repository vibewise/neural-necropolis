# Neural Necropolis Specification

> Where Dead Code Dreams of Vengeance

This is the consumer-facing runtime and API reference for Neural Necropolis.

Use this document for:

- choosing the right run mode
- understanding the public command surface
- building bots against the HTTP API

Gameplay rules and parameter details live in [GAME_MECHANICS.md](GAME_MECHANICS.md). If this file and the engine diverge, the engine is authoritative.

For a shorter setup path, use [QUICKSTART.md](QUICKSTART.md).

## Product Model

Consumers choose between three supported run modes.

| Run mode            | Who decides actions                         | Primary command          | Best for                                       |
| ------------------- | ------------------------------------------- | ------------------------ | ---------------------------------------------- |
| Scripted swarm      | Repo code                                   | `npm run run:scripted`   | Fastest first run, smoke tests, balance checks |
| Local AI bot        | Local repo process calling a model provider | `npm run run:aibots:bot` | Validating one provider-backed bot             |
| OpenClaw agent mode | External OpenClaw agent                     | `npm run run:openclaw`   | Fully agentic tool-using play                  |

Architecturally:

- `scripted` and `aibots` are local bot implementations that share the same HTTP API and SDK loop
- `OpenClaw` is an external integration mode that drives the game through repo helper commands
- it is sensible to expose all three publicly, but it is misleading to call them the same kind of bot

## Shared Runtime Behavior

Install once:

```bash
npm install
```

Unless you override `PORT`, the local dashboard is at `http://localhost:3000`.

The server starts paused by default. After you switch `Turns ON` in the dashboard, a board starts only when all of these are true:

- no other board is currently running
- either 4 heroes are attached immediately, or the 10 second join window expires with at least 1 hero attached
- any configured `BOARD_WARMUP_MS` delay has expired

If port `3000` is busy, override both the server port and the local client URL together:

```bash
npx cross-env PORT=3002 MMORPH_SERVER_URL=http://127.0.0.1:3002 npm run run:scripted
```

## Hello World Scenarios

### 1. Scripted Swarm

Use this when you want the simplest possible run.

```bash
npm install
npm run run:scripted
```

Then open `http://localhost:3000` and switch `Turns ON`.

What this starts:

- the game engine
- a predefined scripted roster made of berserker, explorer, and treasure-hunter personalities

Helpful variation:

```bash
npm run run:scripted -- 4
```

### 2. One Local AI Bot

Use this when you want the smallest provider-backed setup.

Prerequisite:

- slot `A` must be configured in `.env`

Run these in separate terminals:

```bash
npm install
npm run run:engine
npm run run:aibots:bot
```

Then open `http://localhost:3000` and switch `Turns ON`.

What this starts:

- the game engine in one terminal
- one local AI bot process using slot `A` in another terminal

Advanced variation:

```bash
npm run run:aibots
npm run run:aibots -- 4
```

Use the swarm command only when you actually have multiple slots configured.

### 3. OpenClaw Agent Mode

Use this when the decision maker should be an external tool-using agent rather than a local bot process.

Prerequisites:

- OpenClaw CLI installed
- a tool-capable OpenClaw controller model configured
- this repo onboarded for OpenClaw

One-time onboarding:

```bash
npm run run:openclaw:onboard
```

Runtime setup:

```bash
npm run run:openclaw
```

Inside the OpenClaw session, begin with:

```bash
npm run run:openclaw:bootstrap -- --session claw
```

Then open `http://localhost:3000` and switch `Turns ON`.

Important notes:

- `run:openclaw` starts both the Neural Necropolis engine and `openclaw gateway run`
- the gateway matters for agentic play; the OpenClaw daemon is optional for this repo
- use `--slug <slug>` for a stable dungeon-flavored identity such as `crypt-ash`
- use `--persona <scout|raider|slayer|warden>` to pick a starting OpenClaw persona preset

### 4. Autonomous OpenClaw Swarm

Use this when you want several OpenClaw-driven heroes to keep joining boards and playing without manual turn-by-turn intervention.

```bash
npm run run:openclaw:swarm -- 4
```

What this does:

- starts the engine with a longer planning window tuned for model-driven decisions
- starts the OpenClaw gateway
- starts one long-running worker process per hero
- each worker uses the repo SDK loop for register, observe, act, requeue, and board rollover
- each worker calls `openclaw agent --session-id ...` to make one decision per submit phase

Useful variations:

```bash
npm run run:openclaw:bot -- --session crypt-ash --persona scout
OPENCLAW_AGENT_LOCAL=1 npm run run:openclaw:swarm -- 4
```

Notes:

- `run:openclaw:bot` runs one autonomous OpenClaw worker hero
- `run:openclaw:swarm` is the missing one-liner for multi-agent autoplay
- workers keep separate OpenClaw session ids so each hero has isolated memory and decision history

## Public Commands

These are the commands worth documenting for consumers.

### Primary entrypoints

- `npm run run:scripted`: engine plus scripted roster
- `npm run run:aibots:bot`: one provider-backed local AI bot against an already running engine
- `npm run run:aibots`: engine plus an AI swarm
- `npm run run:openclaw`: engine plus OpenClaw gateway
- `npm run run:openclaw:bot`: one autonomous OpenClaw worker hero
- `npm run run:openclaw:swarm`: engine, gateway, and an autonomous OpenClaw swarm

### Useful supporting commands

- `npm run run:engine`: start only the game engine
- `npm run run:runner`: start the status monitor
- `npm run run:all`: start the engine, runner, scripted bots, and one AI bot together

### Individual scripted bots

These are useful for debugging or handcrafted mixes, not for a first consumer run.

- `npm run run:scripted:bot:berserker`
- `npm run run:scripted:bot:explorer`
- `npm run run:scripted:bot:treasure`

### OpenClaw helper commands

These are repo bridge commands used by OpenClaw sessions.

```bash
npm run run:openclaw:bot -- --session crypt-ash --persona scout
npm run run:openclaw:swarm -- 4
npm run run:openclaw:register -- --session claw
npm run run:openclaw:bootstrap -- --session claw
npm run run:openclaw:step -- --session claw
npm run run:openclaw:act -- --session claw --kind move --direction north
npm run run:openclaw:reset -- --session claw
```

Meanings:

- `run:openclaw:bot`: one long-running autonomous worker that uses OpenClaw for turn decisions
- `run:openclaw:swarm`: launch a roster of autonomous OpenClaw workers
- `run:openclaw:register`: register a hero session explicitly
- `run:openclaw:bootstrap`: inspect server state and join the first available board
- `run:openclaw:step`: fetch the latest observation and legal actions for a session
- `run:openclaw:act`: submit one exact legal action
- `run:openclaw:reset`: remove the stored local state file for that session

## Bot Separation

The separation is sensible if you frame it by who is making decisions.

### Scripted bots

- fixed code-driven behavior
- no model dependency
- best for deterministic local testing

The current built-in personalities are consistent with that goal:

- berserker: pressures combat and chases monsters
- explorer: prefers new tiles, shrines, and safe exploration
- treasure hunter: prioritizes loot and profitable exits

### Local AI bots

- local Node processes from this repo
- call a configured provider directly each turn
- use the same registration, observe, and act loop as scripted bots

### OpenClaw agent mode

- external agent runtime
- supports two integration styles:
  - repo helper commands for interactive/manual tool-using control
  - autonomous worker processes that use the shared SDK loop and call `openclaw agent` once per turn
- better treated as an integration tier than as a sibling implementation detail of the local bots

## Public HTTP API

| Method | Path                      | Purpose                           |
| ------ | ------------------------- | --------------------------------- |
| GET    | `/api/health`             | Beat timing and board status      |
| POST   | `/api/heroes/register`    | Register a hero                   |
| GET    | `/api/heroes/:id/observe` | Vision, events, and legal actions |
| POST   | `/api/heroes/:id/act`     | Submit one action                 |
| POST   | `/api/heroes/:id/log`     | Add a bot message to the feed     |
| GET    | `/api/dashboard`          | Current dashboard snapshot        |
| GET    | `/api/boards`             | Board summaries                   |
| GET    | `/api/boards/completed`   | Paginated completed board history |
| GET    | `/api/stream`             | Live updates                      |
| GET    | `/api/leaderboard`        | Score table                       |
| GET    | `/api/seed`               | Current seed                      |

## Shared Bot Loop

Every local bot follows the same high-level loop:

1. register a hero
2. observe the board state
3. choose exactly one legal action
4. submit it during the submit window
5. repeat until the board ends

That shared loop is why `scripted` and `aibots` belong together in the docs.
