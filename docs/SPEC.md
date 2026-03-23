# Neural Necropolis Specification

> Where Dead Code Dreams of Vengeance

This is the consumer-facing runtime and API reference for Neural Necropolis.

The Go engine under `engine/` is the only supported server runtime.

Use this document for:

- connecting a client to a known server address
- choosing the right run mode
- understanding the public command surface
- building bots against the HTTP API

Machine-readable contract:

- [PUBLIC_API.openapi.json](PUBLIC_API.openapi.json)

Gameplay rules and parameter details live in [GAME_MECHANICS.md](GAME_MECHANICS.md). If this file and the engine diverge, the engine is authoritative.

For a shorter setup path, use [QUICKSTART.md](QUICKSTART.md).

For a minimal TypeScript bot example using the shared SDK, use [CONNECT_YOUR_BOT.md](CONNECT_YOUR_BOT.md).

For dashboard standalone-hosting assumptions, use [DASHBOARD_STANDALONE.md](DASHBOARD_STANDALONE.md).

## Contract And Versioning

This file is the human-readable guide. The machine-readable wire contract lives in [PUBLIC_API.openapi.json](PUBLIC_API.openapi.json).

Versioning rules for the public API are:

- the current public contract major is `1`
- the unversioned `/api/*` paths represent the current `v1` contract
- additive response fields and new optional capabilities may ship within `1.x`
- breaking wire changes require a new major contract and a new path namespace such as `/api/v2/*`
- operator-only admin routes are intentionally not part of this first public contract

If this guide and the formal contract diverge, the contract is the authoritative wire-level source and the engine behavior is the final runtime source.

Validation gates that enforce this boundary:

- `npm run validate:contract` checks the OpenAPI document against the shared TypeScript protocol package
- `npm run validate:boundaries` checks that runtime packages stay isolated from deleted legacy runtime paths

## Dashboard Boundary

The dashboard is a client of the engine, not an engine-internal privilege tier.

Phase 0 freezes the current boundary into three surfaces:

### Spectator surface

Read-only dashboard and watcher features depend on these public spectator routes:

- `/api/health`
- `/api/dashboard`
- `/api/boards`
- `/api/boards/completed`
- `/api/stream`
- `/api/leaderboard`
- `/api/seed`

These are the routes that a built-in dashboard, separately hosted dashboard, replay UI, or other browser client may depend on without requiring privileged engine access.

### Player surface

Bot and hero runtimes depend on the player surface:

- `/api/heroes/register`
- `/api/heroes/:id/observe`
- `/api/heroes/:id/act`
- `/api/heroes/:id/heartbeat`
- `/api/heroes/:id/log`

This surface is public but authenticated. It requires the player bearer token, and hero-scoped routes also require the per-hero session token.

### Operator surface

Operator controls remain intentionally outside the first public contract:

- `/api/admin/start`
- `/api/admin/stop`
- `/api/admin/reset`
- `/api/admin/settings`

The browser dashboard may call these routes when the user provides an admin token, but third-party clients should not treat them as part of the stable player or spectator wire contract yet.

## Dashboard Stream Contract

The dashboard event stream is the public live-update transport for spectators and browser clients.

Compatibility rules:

- `/api/stream` is a server-sent event endpoint
- the first emitted event is always `snapshot`
- `snapshot` payloads use the same top-level shape as `/api/dashboard` for the current active board
- `log` payloads are plain text engine or bot messages suitable for feed rendering
- arena-generated log lines prepend bracketed identifiers such as `[arena:...][match:...][duel:n]` when that context exists
- clients should ignore unknown future event types for forward compatibility

This lets the embedded dashboard, a standalone dashboard, or a future framework-based frontend share the same live contract.

## Product Model

The primary product model is remote attach: the game server runs somewhere, a client learns its address, and the client speaks the published protocol.

Reference client modes in this repo:

| Client mode         | Who decides actions                         | Primary command                                                | Best for                                            |
| ------------------- | ------------------------------------------- | -------------------------------------------------------------- | --------------------------------------------------- |
| Remote attached bot | Your client or one repo client              | `NEURAL_NECROPOLIS_SERVER_URL=... npm run run:aibots:bot`      | Validating the public remote workflow               |
| Scripted swarm      | Repo code                                   | `NEURAL_NECROPOLIS_SERVER_URL=... npm run run:scripted:agents` | Scripted multi-agent attach against a live server   |
| Local AI bot        | Local repo process calling a model provider | `npm run run:aibots:bot`                                       | Validating one provider-backed bot locally          |
| OpenClaw agent mode | External OpenClaw agent                     | `npm run run:openclaw:bootstrap -- --session claw`             | Fully agentic tool-using play against a live server |

Architecturally:

- the first-class boundary is `server address + public protocol`
- `scripted` and `aibots` are reference client implementations that share the same HTTP API and SDK loop
- `OpenClaw` is an external integration mode that drives the game through repo helper commands
- server startup and agent startup are intentionally separate concerns

## Shared Runtime Behavior

Remote connection settings used by the TypeScript clients:

- `NEURAL_NECROPOLIS_SERVER_URL`: primary server URL
- `NEURAL_NECROPOLIS_PLAYER_TOKEN`: bearer token for registration and hero routes; defaults to `eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.neural-necropolis-dev-player.signature`
- `NEURAL_NECROPOLIS_ADMIN_TOKEN`: bearer token for admin routes; defaults to `eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.neural-necropolis-dev-admin.signature`
- `NEURAL_NECROPOLIS_AUTH_TOKEN`: optional shared fallback when you want both tokens set together

Install once:

```bash
npm install
```

When you run the server yourself, it binds to `HOST` and `PORT`. Unless you override `PORT`, the local dashboard is at `http://localhost:3000`.

Then open `http://localhost:3000`.

The server starts paused by default. After you switch `Turns ON` in the dashboard, a board starts only when all of these are true:

- no other board is currently running
- either 4 heroes are attached immediately, or the 10 second join window expires with at least 1 hero attached
- any configured `BOARD_WARMUP_MS` delay has expired

If port `3000` is busy, override both the server bind settings and the client URL together:

```bash
npx cross-env PORT=3002 HOST=127.0.0.1 npm run run:engine
npx cross-env NEURAL_NECROPOLIS_SERVER_URL=http://127.0.0.1:3002 npm run run:aibots:bot
```

## Hello World Scenarios

### 1. Remote Attached Agent

Use this when you already have a server address and want the primary public workflow.

Prerequisites:

- a reachable server URL
- if that deployment overrides the built-in player token, the matching player bearer token
- for the example below, slot `A` configured in `.env`

Run:

```bash
npm install
npx cross-env NEURAL_NECROPOLIS_SERVER_URL=http://127.0.0.1:3000 npm run run:aibots:bot
```

If your deployment overrides the default player token, add `NEURAL_NECROPOLIS_PLAYER_TOKEN=...` to the same command.

What this starts:

- one client process that registers, observes, and acts through the published API
- no local engine process unless you start one separately

### 2. Scripted Swarm

Use this when you want a scripted multi-agent attach against an already running server.

```bash
npx cross-env NEURAL_NECROPOLIS_SERVER_URL=http://127.0.0.1:3000 npm run run:scripted:agents -- 4
```

### 3. One Local AI Bot

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
npx cross-env NEURAL_NECROPOLIS_SERVER_URL=http://127.0.0.1:3000 npm run run:aibots:agents -- 4
```

Use the swarm command only when you actually have multiple slots configured.

### 4. OpenClaw Agent Mode

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
npm run run:openclaw:gateway
```

Against an already running server, you can also skip the local wrapper and begin directly with:

```bash
npx cross-env NEURAL_NECROPOLIS_SERVER_URL=http://127.0.0.1:3000 npm run run:openclaw:bootstrap -- --session claw
```

Then open `http://localhost:3000` and switch `Turns ON`.

Important notes:

- `run:openclaw` starts the OpenClaw gateway only
- the gateway matters for agentic play; the OpenClaw daemon is optional for this repo
- use `--slug <slug>` for a stable dungeon-flavored identity such as `crypt-ash`
- use `--persona <scout|raider|slayer|warden>` to pick a starting OpenClaw persona preset
- use `NEURAL_NECROPOLIS_PLAYER_TOKEN` when the target deployment expects a non-default player bearer token

Hero route authentication semantics:

- `/api/heroes/register` requires the player bearer token and returns a `sessionToken`, `leaseExpiresAt`, `leaseTtlMs`, and `sessionStatus`
- `/api/heroes/:id/observe`, `/api/heroes/:id/act`, `/api/heroes/:id/log`, and `/api/heroes/:id/heartbeat` require both the player bearer token and `X-Hero-Session-Token`
- `/api/heroes/:id/observe` and `/api/heroes/:id/heartbeat` return refreshed `leaseExpiresAt`, `leaseTtlMs`, and `sessionStatus` values
- successful hero-scoped requests refresh the lease window for that hero session
- `/api/heroes/:id/act` accepts `Idempotency-Key` and replays the cached result for repeated submissions with the same key on the same hero, board, and turn
- hero route responses include `requestId` in the JSON body and echo it in the `X-Request-Id` response header

Hero session lease semantics:

- if a lease expires before a board starts, the hero is evicted from the open board so the seat can be reused
- if a lease expires during a running board, the hero remains in the simulation but becomes inactive for the rest of that board
- expired hero routes return `expired_session`
- reconnect before expiry by reusing the same `X-Hero-Session-Token` on `observe` or `heartbeat`
- recover after expiry by registering again on an open board

### 5. Autonomous OpenClaw Swarm

Use this when you want several OpenClaw-driven heroes to keep joining boards and playing without manual turn-by-turn intervention.

```bash
npm run run:openclaw:agents -- 4
```

What this does:

- requires an already running engine with a sufficiently long planning window for OpenClaw decisions
- starts or reuses the OpenClaw gateway
- starts one long-running worker process per hero
- each worker uses the repo SDK loop for register, observe, act, requeue, and board rollover
- each worker calls `openclaw agent --session-id ...` to make one decision per submit phase

Useful variations:

```bash
npm run run:openclaw:bot -- --session crypt-ash --persona scout
OPENCLAW_AGENT_LOCAL=1 npm run run:openclaw:agents -- 4
```

Notes:

- `run:openclaw:bot` runs one autonomous OpenClaw worker hero
- `run:openclaw:agents` is the multi-agent autoplay launcher against an already running server
- workers keep separate OpenClaw session ids so each hero has isolated memory and decision history

## Public Commands

These are the commands worth documenting for consumers.

### Primary entrypoints

- `npm run run:engine`: start the authoritative game server
- `npm run run:dashboard:serve`: serve the extracted standalone dashboard package against a configurable API base
- `npm run run:aibots:bot`: one provider-backed client against an already running engine
- `npm run run:openclaw:bootstrap -- --session claw`: inspect and attach an OpenClaw-controlled session to an already running engine
- `npm run run:scripted:agents`: scripted swarm against an already running engine
- `npm run run:aibots:agents`: AI swarm against an already running engine
- `npm run run:openclaw:gateway`: OpenClaw gateway
- `npm run run:openclaw:bot`: one autonomous OpenClaw worker hero
- `npm run run:openclaw:agents`: gateway plus an autonomous OpenClaw swarm against an already running engine

### Useful supporting commands

- `npm run run:runner`: start the status monitor

### Development-only shortcuts

- `npm run run:dev:all`: start the runner, scripted bots, and one AI bot against an already running engine
- `npm run run:all`: legacy alias for `run:dev:all`; do not use it as the primary onboarding path
- `npm run test:dashboard:smoke`: verify the extracted standalone dashboard package against a target server and its cross-origin contract

## Remote Client Troubleshooting

- `401 missing_auth`: no player bearer token was sent. Set `NEURAL_NECROPOLIS_PLAYER_TOKEN`.
- `401 invalid_auth`: the bearer token does not match the target deployment.
- `401 missing_session`: a manual hero route call skipped the `X-Hero-Session-Token` returned by registration.
- `401 invalid_session`: the hero session token does not match the server-side record for that hero.
- `401 expired_session`: the hero lease expired. Re-register for an open board. Bundled SDK clients treat this as a recovery path, not a fatal permanent state.
- `409 wrong_phase`: `act` was sent outside submit phase. Observe again and wait for the next submit window.
- `409 hero_capacity_reached`: the currently open board cannot accept another hero. Retry registration after the next board opens.

Recommended operator order when debugging remote attach:

1. confirm `GET /api/health` works against the target `NEURAL_NECROPOLIS_SERVER_URL`
2. confirm the player token is valid for `POST /api/heroes/register`
3. confirm the client is reusing the `sessionToken` from registration on hero-scoped routes
4. if sessions expire, add heartbeats or reuse the shared SDK loop instead of hand-rolling request timing

### Individual scripted bots

These are useful for debugging or handcrafted mixes, not for a first consumer run.

- `npm run run:scripted:bot:berserker`
- `npm run run:scripted:bot:explorer`
- `npm run run:scripted:bot:treasure`

### OpenClaw helper commands

These are repo bridge commands used by OpenClaw sessions.

```bash
npm run run:openclaw:bot -- --session crypt-ash --persona scout
npm run run:openclaw:agents -- 4
npm run run:openclaw:register -- --session claw
npm run run:openclaw:bootstrap -- --session claw
npm run run:openclaw:step -- --session claw
npm run run:openclaw:act -- --session claw --kind move --direction north
npm run run:openclaw:reset -- --session claw
```

Meanings:

- `run:openclaw:bot`: one long-running autonomous worker that uses OpenClaw for turn decisions
- `run:openclaw:agents`: launch a roster of autonomous OpenClaw workers
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
- local scripted bots: deterministic local processes with no model dependency

The current built-in personalities are consistent with that goal:

- berserker: pressures combat and chases monsters
- explorer: prefers new tiles, shrines, and safe exploration
- treasure hunter: prioritizes loot and profitable exits

### Local AI bots

- local Node processes from this repo
- call a configured provider directly each turn
- use the same registration, observe, and act loop as scripted bots
- AI bots: model-driven bots that choose among legal actions at runtime

### OpenClaw agent mode

- external agent runtime
- supports two integration styles:
  - repo helper commands for interactive/manual tool-using control
  - autonomous worker processes that use the shared SDK loop and call `openclaw agent` once per turn
- better treated as an integration tier than as a sibling implementation detail of the local bots

## Public HTTP API

| Method | Path                        | Purpose                           |
| ------ | --------------------------- | --------------------------------- |
| GET    | `/api/health`               | Beat timing and board status      |
| POST   | `/api/heroes/register`      | Register a hero                   |
| GET    | `/api/heroes/:id/observe`   | Vision, events, and legal actions |
| POST   | `/api/heroes/:id/act`       | Submit one action                 |
| POST   | `/api/heroes/:id/heartbeat` | Renew the hero session lease      |
| POST   | `/api/heroes/:id/log`       | Add a bot message to the feed     |
| GET    | `/api/dashboard`            | Current dashboard snapshot        |
| GET    | `/api/boards`               | Board summaries                   |
| GET    | `/api/boards/completed`     | Paginated completed board history |
| GET    | `/api/stream`               | Live updates                      |
| GET    | `/api/leaderboard`          | Score table                       |
| GET    | `/api/seed`                 | Current seed                      |

## API Notes

Dashboard-facing spectator notes:

- `/api/dashboard` is the canonical read model for the currently focused board snapshot
- `/api/boards` is the canonical list view for queued, open, running, and completed board summaries
- `/api/boards/completed` is the canonical paginated completed-board history surface
- `/api/stream` is the canonical live spectator stream

Observation responses include:

- hero state
- visible terrain
- visible monsters
- visible heroes
- visible non-hostile characters
- visible floor items
- recent events
- legal actions

Legal actions are authoritative.

Action submission rules:

- A hero may have one submitted action per turn.
- additional submissions in the same turn are rejected

Runtime settings exposed by the public API include:

- host and port
- submit window duration
- resolve window duration
- maximum board length
- warm-up before boards auto-start

## Shared Bot Loop

Every local bot follows the same high-level loop:

1. register a hero
2. observe the board state
3. choose one legal action
4. submit it during the submit window
5. repeat until the board ends

That shared loop is why `scripted` and `aibots` belong together in the docs.
