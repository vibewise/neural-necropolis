# Architecture

Neural Necropolis is organized by runtime role rather than by abstract technical layer.

That keeps the first-run path small:

1. run the Go engine
2. open the dashboard
3. optionally attach a bot runtime or start prompt runner

## Top-Level Layout

- `engine/`: authoritative Go runtime for rules, board state, turns, and the embedded dashboard host
- `apps/`: human-facing or operator-facing TypeScript applications
- `runtimes/`: autonomous client processes that attach to the engine through the public API
- `packages/`: reusable TypeScript libraries shared by apps and runtimes
- `scripts/`: local orchestration, demos, and validation helpers
- `integrations/`: workspace-facing integration assets, skills, and external-tool glue
- `docs/`: onboarding, contracts, and product/runtime reference

## Runtime Roles

### Engine

`engine/` is the source of truth.

It owns:

- board generation and simulation
- turn progression and rule enforcement
- HTTP and event-stream endpoints
- embedded dashboard asset serving

Everything else is a client or adjacent service.

### Apps

`apps/` contains deployable TypeScript applications used directly by humans or operators.

- `apps/dashboard-app`: React dashboard UI built separately and embedded back into the Go server for the default local experience
- `apps/prompt-runner`: hosted-agent control plane for manifest storage, job creation, and worker supervision

These are not shared libraries. They are executable products.

### Runtimes

`runtimes/` contains autonomous clients that play through the public API.

- `runtimes/scripted-bots`: deterministic scripted hero bots
- `runtimes/ai-bots`: provider-backed local AI bot runtime
- `runtimes/openclaw-runner`: OpenClaw-backed worker and CLI helpers

These runtimes are peers of the dashboard as engine clients. They are not engine internals.

### Packages

`packages/` is reserved for reusable TypeScript code.

- `packages/agent-sdk`: shared client SDK for register, observe, act, and bot-loop orchestration
- `packages/protocol-ts`: shared protocol types and constants

If code is meant to be imported by multiple apps or runtimes, it belongs here. If it is a deployable process, it belongs in `apps/` or `runtimes/`.

### Integrations

`integrations/` contains non-runtime assets that belong to an external integration rather than to the game engine or a deployable app.

- `integrations/openclaw/skills`: OpenClaw-specific workspace skill assets and helper instructions

These assets support an integration workflow, but they are not themselves a server, bot runtime, or shared library.

## Design Rule

Keep the public story simple:

- one authoritative server
- one default dashboard entrypoint
- optional direct bot runtimes
- optional hosted prompt control plane

Folder layout should reinforce that story, not make newcomers reverse-engineer it.
