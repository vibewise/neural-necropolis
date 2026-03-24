# Neural Necropolis

> Where Dead Code Dreams of Vengeance

Neural Necropolis is a beat-based dungeon arena where heroes explore, fight, loot, and escape across procedurally generated boards. The public surface is intentionally small: run the authoritative game server, get its address, and point a client at it.

The Go engine under `engine/` is the only supported server runtime.

## Start Here

If you are running locally, there is one primary path:

1. start the server
2. open `http://127.0.0.1:3000`
3. attach bots directly or run prompt runner and submit a hosted job

The recommended first experience is the **hosted prompt path**: clone the repo, set an API key, start the server and prompt runner, then launch a hosted agent from the dashboard. See [docs/START_HERE.md](docs/START_HERE.md) for the step-by-step walkthrough.

Everything else is optional infrastructure or deeper reference material.

Primary docs:

- start here: [docs/START_HERE.md](docs/START_HERE.md)
- command-first setup: [docs/QUICKSTART.md](docs/QUICKSTART.md)
- prompt runner demo: [docs/prompt-runner/PROMPT_RUNNER_DEMO.md](docs/prompt-runner/PROMPT_RUNNER_DEMO.md)

Optional or advanced docs:

- connect a custom bot through the SDK: [docs/CONNECT_YOUR_BOT.md](docs/CONNECT_YOUR_BOT.md)
- repo runtime layout and package roles: [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md)
- prompt manifest product contract: [docs/prompt-runner/MANIFEST.md](docs/prompt-runner/MANIFEST.md)
- hosted prompt runner control plane: [docs/prompt-runner/HOSTED_PROMPT_RUNNER.md](docs/prompt-runner/HOSTED_PROMPT_RUNNER.md)
- prompt manifest schema: [docs/prompt-runner/MANIFEST.schema.json](docs/prompt-runner/MANIFEST.schema.json)
- public runtime and API reference: [docs/SPEC.md](docs/SPEC.md)
- machine-readable public API contract: [docs/PUBLIC_API.openapi.json](docs/PUBLIC_API.openapi.json)
- gameplay rules and parameters: [docs/GAME_MECHANICS.md](docs/GAME_MECHANICS.md)

Prompt-runner docs live together under [docs/prompt-runner/](docs/prompt-runner/). If you are using hosted agents, start with the demo guide, then use the manifest contract and hosted control-plane reference as needed.

## Repo Layout

The repo is organized by runtime role:

```text
engine/      authoritative Go server and embedded dashboard host
apps/        human-facing or operator-facing TypeScript apps
runtimes/    autonomous bot processes and runtime helpers
packages/    shared TypeScript libraries
scripts/     local orchestration and validation helpers
integrations/ workspace-specific integration assets and skills
docs/        onboarding, contracts, and runtime reference
```

Today that means:

```text
engine/
apps/
   dashboard-app/
   prompt-runner/
runtimes/
   scripted-bots/
   ai-bots/
   openclaw-runner/
packages/
   agent-sdk/
   protocol-ts/
integrations/
   openclaw/
      skills/
docs/
   prompt-runner/
```

## Integrations

Current integration surface:

- `integrations/openclaw/skills/`: OpenClaw-facing skill prompts and helper assets used when wiring external OpenClaw sessions into the game
- `runtimes/openclaw-runner/`: the actual local OpenClaw worker runtime, gateway commands, and attach flows that run against the server

## Toolchain

- Node.js 22+
- npm 10+

This repo uses npm workspaces and `workspace:*` dependencies. If `npm install` fails with `Unsupported URL Type "workspace:"`, the npm client on your machine is too old or broken even if `node` itself is current.

## Primary Workflow

If you are running locally, use this path first:

```bash
npm install
npm run run:engine
```

Then open:

```text
http://127.0.0.1:3000
```

Then choose one optional attachment path:

- direct bots: scripted, AI bots, or OpenClaw
- hosted prompt jobs through prompt runner

Arena mode can also run mixed model providers inside the engine itself. Each
configured arena bot has its own `provider` and `model`, so a two-bot duel can
pair `openai / gpt-4o` against `groq / llama-3.3-70b-versatile` as long as the
engine process has both `OPENAI_API_KEY` and `GROQ_API_KEY` available.

The shared SDK is the supported client entrypoint for TypeScript bots. Start with [docs/CONNECT_YOUR_BOT.md](docs/CONNECT_YOUR_BOT.md) if you want to attach your own bot instead of using a bundled runtime.

If you are self-hosting the server, the equivalent local flow is:

1. run the Go engine on some host
2. note the server address it prints
3. set `NEURAL_NECROPOLIS_SERVER_URL` in any client runtime
4. register, observe, and act through the published HTTP protocol

One-command local demos:

- `npm run run:demo:local`: starts the server and a small scripted bot mix for a local dashboard demo
- `npm run run:demo:prompt-runner`: starts the server and prompt runner, then prints the exact upload and hosted-job commands
- `npm run run:demo:prompt-runner -- --auto`: starts the server and prompt runner, uploads the example manifest, creates the hosted job, and prints the job status

The server starts paused, so agents can attach before you switch `Turns ON`.

The same flow works against a remote host. Replace the local URL with the server address you were given.

Remote attach example with an explicit token:

```bash
npx cross-env NEURAL_NECROPOLIS_SERVER_URL=https://your-server.example NEURAL_NECROPOLIS_PLAYER_TOKEN=replace-me npm run run:aibots:bot
```

## Connection Configuration

- `NEURAL_NECROPOLIS_SERVER_URL`: primary server URL for all TypeScript client runtimes
- `NEURAL_NECROPOLIS_PLAYER_TOKEN`: bearer token for hero registration and hero routes; defaults to `eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.neural-necropolis-dev-player.signature`
- `NEURAL_NECROPOLIS_ADMIN_TOKEN`: bearer token for admin routes and dashboard controls; defaults to `eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.neural-necropolis-dev-admin.signature`
- `NEURAL_NECROPOLIS_AUTH_TOKEN`: optional shared fallback that sets both tokens to the same value when you do not want them split
- `HOST` and `PORT`: server bind settings when you run the Go engine yourself

Hero routes also require a per-hero session token returned by `/api/heroes/register` and the server supports `Idempotency-Key` on `/api/heroes/:id/act`. Responses on those routes now also carry a `requestId` field plus the `X-Request-Id` header.

The dashboard remains a server-served static client. The default `:3000` UI is now the embedded React build, while the old monolithic HTML remains temporarily available at `/legacy` during the retirement period. Admin credentials are still entered only in the browser.

## Reference Clients And Dev Shortcuts

Reference client families:

1. `scripted`
   Repo code makes every decision. Best for smoke tests and balance checks.
2. `aibots`
   Local bot processes in this repo call a configured LLM provider each turn through the shared SDK.
3. `OpenClaw`
   An external OpenClaw agent or worker uses repo helper commands to inspect state and submit legal actions.

Agent swarm commands are separate from the server. Start `npm run run:engine` first, then point any agent launcher at that server.

Development-only shortcuts:

- `npm run run:dev:all`: local convenience wrapper for the runner plus a mixed set of built-in bots against an already running server
- `npm run run:all`: legacy alias for `run:dev:all`; keep it only for existing muscle memory, not for primary docs or onboarding

What you will see:

- the active board and queued boards
- live hero panels
- turn and event feeds
- completed runs as they finish

## What Happens In Every Mode

- the dashboard is served by the game server at `http://HOST:PORT`
- the server starts paused by default
- after you switch `Turns ON`, a board starts when no other board is running and either 4 heroes have joined or the join window expires with at least 1 hero attached
- scripted bots and local AI bots register and act through the same HTTP API and shared SDK timing loop

If port `3000` is already used on your machine, pick another one and keep clients pointed at the same value:

```bash
npx cross-env PORT=3002 HOST=127.0.0.1 npm run run:engine
npx cross-env NEURAL_NECROPOLIS_SERVER_URL=http://127.0.0.1:3002 npm run run:aibots:bot
```

## Primary Commands

Most consumers only need these entrypoints:

- `npm run run:engine`: run the authoritative game server
- `npm run run:dashboard:dev`: start the new Vite + React dashboard app scaffold for Phase 1 work
- `npm run run:demo:local`: one-command local server plus small scripted demo mix
- `npm run run:demo:prompt-runner`: one-command local server plus prompt-runner control plane demo
- `npm run run:dashboard:serve`: build and serve the same extracted dashboard app separately when you intentionally want a second UI host
- `npm run run:aibots:bot`: connect one provider-backed client to an already running server
- `npm run run:openclaw:bootstrap -- --session claw`: inspect and attach an OpenClaw-controlled session to an already running server
- `npm run run:openclaw:bot`: start one persistent autonomous OpenClaw worker against an already running server
- `npm run run:prompt-runner`: start the hosted prompt-runner control plane on `127.0.0.1:4010` by default
- `npm run run:scripted:agents`: start a scripted swarm against an already running server
- `npm run run:aibots:agents`: start an AI swarm against an already running server
- `npm run run:openclaw:gateway`: start the OpenClaw gateway
- `npm run run:openclaw:agents -- 4`: start 4 autonomous OpenClaw workers against an already running server

Advanced commands such as individual scripted bots, `run:runner`, `run:dev:all`, and the low-level OpenClaw helper commands are documented in [docs/SPEC.md](docs/SPEC.md).

## Troubleshooting

- `401 missing_auth` or `401 invalid_auth`: the deployment expects a different bearer token. Set `NEURAL_NECROPOLIS_PLAYER_TOKEN` for hero routes and `NEURAL_NECROPOLIS_ADMIN_TOKEN` for dashboard controls.
- `401 missing_session` or `401 invalid_session`: the SDK-managed hero session token is absent or stale. Register again rather than retrying the same manual request.
- `401 expired_session`: the hero lease expired. Re-register on an open board, or let the shared SDK recover automatically.
- `409 wrong_phase`: actions are only accepted during submit phase. Observe again and wait for the next submit window.
- `409 hero_capacity_reached`: the open board is full. Retry registration later or attach after the next board opens.

The longer copy-paste troubleshooting flow for custom bots is in [docs/CONNECT_YOUR_BOT.md](docs/CONNECT_YOUR_BOT.md).

## Validation Gates

- `npm run validate:contract`: checks the published OpenAPI contract against the shared TypeScript protocol surface
- `npm run validate:boundaries`: checks that runtime entrypoints route through workspace packages and that removed legacy runtime files do not reappear
- `npm run validate`: runs both validation gates together

## License

This project is released under the MIT License. See [LICENSE](LICENSE).
