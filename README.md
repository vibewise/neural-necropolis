# Neural Necropolis

> Where Dead Code Dreams of Vengeance

Neural Necropolis is a beat-based dungeon arena where heroes explore, fight, loot, and escape across procedurally generated boards. The public surface is intentionally small: you can run the game in one of three supported modes and watch everything from the local dashboard.

Quick links:

- command-first setup: [docs/QUICKSTART.md](docs/QUICKSTART.md)
- public runtime and API reference: [docs/SPEC.md](docs/SPEC.md)
- gameplay rules and parameters: [docs/GAME_MECHANICS.md](docs/GAME_MECHANICS.md)

## Supported Run Modes

The docs now use `run mode` as the top-level concept because that is what consumers actually choose.

1. `scripted swarm`
   Repo code makes every decision. No model provider and no OpenClaw install are required.
2. `local AI bots`
   Local bot processes in this repo call a configured LLM provider each turn through the shared bot SDK.
3. `OpenClaw agent mode`
   An external OpenClaw agent uses repo helper commands to inspect the game and submit legal actions.

Important distinction:

- `scripted` and `aibots` are local bot implementations that share the same SDK loop.
- `OpenClaw` is an external agent integration mode.
- All three are valid public ways to run the game, but they are not the same architectural category.

## Fastest Hello World

If you only want to see the game running, use scripted mode:

```bash
npm install
npm run run:scripted
```

Then open `http://localhost:3000` and switch `Turns ON`.

What you will see:

- the active board and queued boards
- live hero panels
- turn and event feeds
- completed runs as they finish

## What Happens In Every Mode

- the dashboard is local at `http://localhost:3000` unless you override `PORT`
- the server starts paused by default
- after you switch `Turns ON`, a board starts when no other board is running and either 4 heroes have joined or the join window expires with at least 1 hero attached
- scripted bots and local AI bots register and act through the same HTTP API and shared SDK timing loop

If port `3000` is already used on your machine, pick another one and keep bots pointed at the same value:

```bash
npx cross-env PORT=3002 MMORPH_SERVER_URL=http://127.0.0.1:3002 npm run run:scripted
```

## Primary Commands

Most consumers only need these entrypoints:

- `npm run run:scripted`: start the engine plus the scripted roster
- `npm run run:aibots:bot`: run one local AI bot against an already running engine
- `npm run run:aibots`: start the engine plus an AI swarm when you have multiple slots configured
- `npm run run:openclaw`: start the engine and OpenClaw gateway together
- `npm run run:openclaw:swarm -- 4`: start the engine, gateway, and 4 autonomous OpenClaw workers

Advanced commands such as individual scripted bots, `run:runner`, and the low-level OpenClaw helper commands are documented in [docs/SPEC.md](docs/SPEC.md).

## License

This project is released under the MIT License. See [LICENSE](LICENSE).
