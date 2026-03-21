# Neural Necropolis

> Where Dead Code Dreams of Vengeance

Neural Necropolis is a beat-based dungeon arena where heroes explore, fight, loot, and escape across procedurally generated boards. The public surface is intentionally small: run the authoritative game server, get its address, and point a client at it.

The Go engine under `engine/` is the only supported server runtime.

Quick links:

- command-first setup: [docs/QUICKSTART.md](docs/QUICKSTART.md)
- connect a custom bot through the SDK: [docs/CONNECT_YOUR_BOT.md](docs/CONNECT_YOUR_BOT.md)
- standalone dashboard assumptions: [docs/DASHBOARD_STANDALONE.md](docs/DASHBOARD_STANDALONE.md)
- prompt manifest product contract: [docs/PROMPT_MANIFEST.md](docs/PROMPT_MANIFEST.md)
- hosted prompt runner control plane: [docs/HOSTED_PROMPT_RUNNER.md](docs/HOSTED_PROMPT_RUNNER.md)
- prompt manifest schema: [docs/PROMPT_MANIFEST.schema.json](docs/PROMPT_MANIFEST.schema.json)
- public runtime and API reference: [docs/SPEC.md](docs/SPEC.md)
- machine-readable public API contract: [docs/PUBLIC_API.openapi.json](docs/PUBLIC_API.openapi.json)
- gameplay rules and parameters: [docs/GAME_MECHANICS.md](docs/GAME_MECHANICS.md)

## Toolchain

- Node.js 22+
- npm 10+

This repo uses npm workspaces and `workspace:*` dependencies. If `npm install` fails with `Unsupported URL Type "workspace:"`, the npm client on your machine is too old or broken even if `node` itself is current.

## Primary Workflow

The architecture target is remote attach:

1. get a server URL
2. get a player token if the deployment does not use the built-in default
3. run a client against that server
4. open the dashboard or stream viewer

The shared SDK is the supported client entrypoint for TypeScript bots. Start with [docs/CONNECT_YOUR_BOT.md](docs/CONNECT_YOUR_BOT.md) if you want to attach your own bot instead of using a bundled runtime.

If you are self-hosting the server, the equivalent local flow is:

1. run the Go engine on some host
2. note the server address it prints
3. set `NEURAL_NECROPOLIS_SERVER_URL` in any client runtime
4. register, observe, and act through the published HTTP protocol

Minimal local example:

```bash
npm install
npm run run:engine
```

Then, in another terminal:

```bash
npx cross-env NEURAL_NECROPOLIS_SERVER_URL=http://127.0.0.1:3000 npm run run:aibots:bot
```

Then open `http://localhost:3000`. The server starts paused, so agents can attach before you switch `Turns ON`.

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

The dashboard remains a server-served static client. It no longer receives admin credentials through server-side HTML injection; enter an admin token in the dashboard itself when you need operator controls.

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
- `npm run run:dashboard:serve`: serve the extracted standalone dashboard package locally
- `npm run run:aibots:bot`: connect one provider-backed client to an already running server
- `npm run run:openclaw:bootstrap -- --session claw`: inspect and attach an OpenClaw-controlled session to an already running server
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

Standalone dashboard smoke path:

- `npm run test:dashboard:smoke`: verify the extracted dashboard package against `NEURAL_NECROPOLIS_SERVER_URL` or the default local server

The longer copy-paste troubleshooting flow for custom bots is in [docs/CONNECT_YOUR_BOT.md](docs/CONNECT_YOUR_BOT.md).

## Validation Gates

- `npm run validate:contract`: checks the published OpenAPI contract against the shared TypeScript protocol surface
- `npm run validate:boundaries`: checks that runtime entrypoints route through workspace packages and that removed legacy runtime files do not reappear
- `npm run validate`: runs both validation gates together

## License

This project is released under the MIT License. See [LICENSE](LICENSE).
