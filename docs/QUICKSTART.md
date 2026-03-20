# Neural Necropolis Quickstart

This page is for consumers who want a small number of obvious ways to get the game moving.

## Pick One Mode

There are three supported run modes:

1. `scripted swarm`
   Fastest path. No model provider and no OpenClaw install.
2. `local AI bot`
   A local bot process in this repo calls your configured model provider.
3. `OpenClaw agent mode`
   An external OpenClaw agent inspects the game through repo helper commands.

Use `scripted swarm` if you only want a first successful run.

## Shared Behavior

In every mode:

- the dashboard is local at `http://localhost:3000` unless you override `PORT`
- the server starts with turns paused
- after you open the dashboard, switch `Turns ON`
- a board starts when no other board is running and either 4 heroes have joined or the join window expires with at least 1 hero attached

## Hello World 1: Scripted Swarm

Best for: first run, smoke tests, watching the game without any model setup.

```bash
npm install
npm run run:scripted
```

Then:

1. open `http://localhost:3000`
2. switch `Turns ON`
3. watch the scripted roster join, move, fight, and score

Notes:

- `run:scripted` starts the engine and a built-in roster together
- `npm run run:scripted -- 4` runs a smaller swarm
- no `.env` model setup is required

## Hello World 2: One Local AI Bot

Best for: validating one configured provider slot before trying an AI swarm.

Prerequisite:

- configure slot `A` in `.env` with a provider, model alias, and credentials

Run these commands in separate terminals:

```bash
npm install
npm run run:engine
npm run run:aibots:bot
```

Then:

1. open `http://localhost:3000`
2. switch `Turns ON`
3. watch the AI bot queue, observe, and submit actions

Notes:

- `run:aibots:bot` is the friendliest AI entrypoint because it only needs one slot
- `run:aibots` is the swarm version and is better once you have multiple slots configured
- by default `run:aibots:bot` uses slot `A`

## Hello World 3: OpenClaw Agent Mode

Best for: fully agentic play where the controller can inspect state and use helper commands.

Prerequisites:

- OpenClaw CLI installed
- a tool-capable OpenClaw model configured

One-time onboarding:

```bash
npm install
npm run run:openclaw:onboard
```

Runtime setup:

```bash
npm run run:openclaw
```

Inside your OpenClaw session, start with:

```bash
npm run run:openclaw:bootstrap -- --session claw
```

Then:

1. open `http://localhost:3000`
2. switch `Turns ON`
3. let the OpenClaw session continue from the bootstrap result and choose legal actions

Notes:

- `run:openclaw` starts the game engine and the OpenClaw gateway together
- OpenClaw is a separate agent runtime, not the same local bot implementation used by `scripted` and `aibots`
- use `--slug <name>` if you want a stable dungeon-flavored identity such as `crypt-ash`

## Hello World 4: Autonomous OpenClaw Swarm

Best for: one command that launches several OpenClaw-driven heroes that keep joining boards and playing turns on their own.

```bash
npm run run:openclaw:swarm -- 4
```

What this starts:

- the game engine
- the OpenClaw gateway
- four long-running OpenClaw workers with separate sessions and personas

Notes:

- each worker keeps its own OpenClaw session memory with `openclaw agent --session-id ...`
- workers use the same repo SDK loop as local bots, so they automatically re-queue after death or board completion
- set `OPENCLAW_AGENT_LOCAL=1` if you want each worker to force local embedded OpenClaw execution instead of going through the gateway

## Which Command Should I Reach For?

- I just want to see the game run: `npm run run:scripted`
- I want to test one provider-backed bot: `npm run run:engine` plus `npm run run:aibots:bot`
- I want a multi-bot AI swarm: `npm run run:aibots`
- I want a fully agentic external controller: `npm run run:openclaw`
- I want autonomous OpenClaw heroes with one command: `npm run run:openclaw:swarm -- 4`

The longer reference, helper commands, and API surface are in [SPEC.md](SPEC.md).
