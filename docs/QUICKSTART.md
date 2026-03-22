# Neural Necropolis Quickstart

This repo treats the server and agents as separate processes, and the default workflow is remote attach.

If you want the clearest local starting point, read [START_HERE.md](START_HERE.md) first.

Rule of thumb:

1. get a server URL
2. get a player token if needed
3. point your agent at that server
4. open the dashboard
5. turn turns on when you actually want the board to progress

This file is command-first. It answers: “I already know which client path I want; what exact commands do I run?”

Use the other docs like this:

- [START_HERE.md](START_HERE.md): the default local flow and component map
- [prompt-runner/PROMPT_RUNNER_DEMO.md](prompt-runner/PROMPT_RUNNER_DEMO.md): hosted prompt-agent demo
- [prompt-runner/MANIFEST.md](prompt-runner/MANIFEST.md): prompt manifest contract and example shape
- [prompt-runner/HOSTED_PROMPT_RUNNER.md](prompt-runner/HOSTED_PROMPT_RUNNER.md): hosted control-plane behavior and API surface

All prompt-runner-specific docs and examples now live under `docs/prompt-runner/`.

Demo shortcuts:

- `npm run run:demo:local`: start the server and a small scripted demo mix
- `npm run run:demo:prompt-runner`: start the server and prompt runner, then print the hosted demo commands
- `npm run run:demo:prompt-runner -- --auto`: start the server and prompt runner, upload the example manifest, create the hosted job automatically, and print the job status

Toolchain requirement:

- Node.js 22+
- npm 10+

## Fastest Path: Attach To An Existing Server

If someone already gave you a running server, start here.

Environment examples:

```bash
npx cross-env NEURAL_NECROPOLIS_SERVER_URL=https://your-server.example NEURAL_NECROPOLIS_PLAYER_TOKEN=replace-me npm run run:aibots:bot
```

Dashboard-only admin example:

```bash
npx cross-env NEURAL_NECROPOLIS_SERVER_URL=https://your-server.example NEURAL_NECROPOLIS_ADMIN_TOKEN=replace-me npm run run:runner
```

If you are building your own TypeScript client, use [CONNECT_YOUR_BOT.md](CONNECT_YOUR_BOT.md).

## Self-Host The Server

Start the authoritative server in its own terminal:

```bash
npm install
npm run run:engine
```

Optional bind override:

```bash
npx cross-env HOST=127.0.0.1 PORT=3002 npm run run:engine
```

Then open the dashboard at the address the server prints.

Shared behavior:

- the server starts paused
- the dashboard should show `Turns OFF` on first load
- any configured global warm-up counts down before auto-start is allowed
- only one board runs at a time
- a board starts immediately at 4 heroes
- otherwise a board starts after 10 seconds if at least 1 hero joined

## Agent Connection Settings

Set these in the agent terminal when needed:

- `NEURAL_NECROPOLIS_SERVER_URL`: the server to connect to
- `NEURAL_NECROPOLIS_PLAYER_TOKEN`: player bearer token when the deployment overrides the built-in default
- `NEURAL_NECROPOLIS_ADMIN_TOKEN`: only needed for dashboard or admin control access
- `NEURAL_NECROPOLIS_AUTH_TOKEN`: optional shared fallback if the deployment uses the same token for both roles

The bundled SDK clients automatically handle the per-hero session token returned by registration.

## One Agent

### Scripted Bot

```bash
npx cross-env NEURAL_NECROPOLIS_SERVER_URL=http://127.0.0.1:3000 npm run run:scripted:bot:berserker
```

Other scripted entries:

- `npm run run:scripted:bot:explorer`
- `npm run run:scripted:bot:treasure`

### AI Bot

Prerequisite:

- configure slot `A` in `.env`

```bash
npx cross-env NEURAL_NECROPOLIS_SERVER_URL=http://127.0.0.1:3000 npm run run:aibots:bot
```

### OpenClaw Agent

Prerequisites:

- OpenClaw CLI installed
- a tool-capable OpenClaw model configured

Choose the command that matches the experience you want:

- `npm run run:openclaw:bootstrap`: inspect the server, join an open board if possible, print the current state, then exit
- `npm run run:openclaw:bot`: one persistent autonomous OpenClaw worker hero; this is the command most people want
- `npm run run:openclaw:agents -- 1`: the same persistent worker flow, wrapped in the swarm launcher

If you want a specific saved session, pass `--session <name>` explicitly.

One-time onboarding:

```bash
npm run run:openclaw:onboard
```

Optional gateway terminal:

```bash
npm run run:openclaw:gateway
```

Persistent autonomous worker against an already running server:

```bash
npx cross-env NEURAL_NECROPOLIS_SERVER_URL=http://127.0.0.1:3000 OPENCLAW_AGENT_LOCAL=1 npm run run:openclaw:bot -- --session crypt-ash --slug crypt-ash --persona scout
```

One-shot bootstrap against an already running server:

```bash
npx cross-env NEURAL_NECROPOLIS_SERVER_URL=http://127.0.0.1:3000 npm run run:openclaw:bootstrap -- --session claw
```

Local Windows flow with one persistent OpenClaw bot:

1. Terminal 1, start the server with a longer planning window for OpenClaw:

```bash
npx cross-env BEAT_PLANNING_MS=30000 npm run run:engine
```

2. Terminal 2, start one persistent OpenClaw worker:

```bash
npx cross-env NEURAL_NECROPOLIS_SERVER_URL=http://127.0.0.1:3000 OPENCLAW_AGENT_LOCAL=1 npm run run:openclaw:bot -- --session crypt-ash --slug crypt-ash --persona scout
```

3. Browser, open the dashboard and switch `Turns ON`:

```text
http://127.0.0.1:3000
```

## Swarm Commands

These commands start agents only. They do not start the server.

Scripted, 1 bot:

```bash
npx cross-env NEURAL_NECROPOLIS_SERVER_URL=http://127.0.0.1:3000 npm run run:scripted:agents -- 1
```

Scripted, 4 bots:

```bash
npx cross-env NEURAL_NECROPOLIS_SERVER_URL=http://127.0.0.1:3000 npm run run:scripted:agents -- 4
```

AI bots, 1 bot:

```bash
npx cross-env NEURAL_NECROPOLIS_SERVER_URL=http://127.0.0.1:3000 npm run run:aibots:agents -- 1
```

AI bots, 4 bots:

```bash
npx cross-env NEURAL_NECROPOLIS_SERVER_URL=http://127.0.0.1:3000 npm run run:aibots:agents -- 4
```

OpenClaw agents, 1 bot:

```bash
npx cross-env NEURAL_NECROPOLIS_SERVER_URL=http://127.0.0.1:3000 npm run run:openclaw:agents -- 1
```

OpenClaw agents, 4 bots:

```bash
npx cross-env NEURAL_NECROPOLIS_SERVER_URL=http://127.0.0.1:3000 npm run run:openclaw:agents -- 4
```

Behavior notes:

- `run:scripted:agents`, `run:aibots:agents`, and `run:openclaw:agents` require an already running server
- `run:scripted:agents` tries to set the server submit window to `2000ms` through `/api/admin/settings` before attaching bots; override with `SCRIPTED_SUBMIT_WINDOW_MS`
- `run:openclaw:agents` still starts or reuses the OpenClaw gateway because that is agent infrastructure, not game-server infrastructure
- `run:openclaw:bot` and `run:openclaw:agents` are persistent worker modes; `run:openclaw:bootstrap` is not
- with count `1`, the wrappers use the first roster entry:
- scripted: first scripted slot
- aibots: slot `A`
- openclaw: `oc1 / crypt-ash / scout`

## Troubleshooting

- `401 missing_auth` or `401 invalid_auth`: set `NEURAL_NECROPOLIS_PLAYER_TOKEN` or `NEURAL_NECROPOLIS_ADMIN_TOKEN` for the target deployment.
- `401 expired_session`: the server expired the hero lease. Re-register on an open board. The shared SDK does this automatically for bundled runtimes.
- `409 wrong_phase`: wait for the next submit phase before calling `act`.
- `409 hero_capacity_reached`: the current open board is full. Retry after the next board opens.

For a custom TypeScript bot example and a fuller troubleshooting matrix, use [CONNECT_YOUR_BOT.md](CONNECT_YOUR_BOT.md).

Static-host smoke check:

```bash
npx cross-env NEURAL_NECROPOLIS_SERVER_URL=http://127.0.0.1:3000 npm run test:dashboard:smoke
```

## Are OpenClaw Bots Really Agents?

Yes.

The OpenClaw workers are not scripted heuristics pretending to be agents. They are long-running workers that:

1. inspect game state through the shared SDK
2. call OpenClaw for a decision each submit phase
3. parse the returned action
4. submit that legal action back through the public API

Main files involved:

- `scripts/run-openclaw-swarm.mjs`
- `runtimes/openclaw-runner/src/autoplay.ts`
- `runtimes/openclaw-runner/src/game-cli.ts`
- `packages/agent-sdk/src/index.ts`

## Operational Model

Keep these boundaries clean:

- server terminal: `npm run run:engine`
- dashboard tab: monitor the active board and control turns
- agent terminals: scripted bots, AI bots, or OpenClaw workers

That separation is intentional now. The repo no longer treats “start the server” and “start the agents” as one combined action.

The longer reference and public API surface are in [SPEC.md](SPEC.md).
