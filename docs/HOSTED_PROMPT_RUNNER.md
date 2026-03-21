# Hosted Prompt Runner

This is the Phase 6 control-plane implementation for hosted prompt agents.

The game engine still owns the authoritative board state. The prompt runner is a separate Node service that stores reviewed prompt manifests, creates jobs, and runs workers that connect through the same public API as any other client.

## What Exists

- workspace package: `packages/prompt-runner`
- control-plane HTTP API for manifest storage and job creation
- file-backed persistence under `PROMPT_RUNNER_DATA_DIR` or `tmp/prompt-runner`
- worker execution path that validates a manifest, resolves operator-managed model credentials, and plays one board through `@neural-necropolis/agent-sdk`
- per-job logs for audit and replay support
- quota guards for global and per-owner concurrent jobs
- dashboard integration: the built-in and standalone dashboards now expose a first `Hosted Agents` tab for prompt drafting, manifest storage, job launch, job inspection, log viewing, and cancel actions

## Dashboard Status

The current dashboard integration is intentionally the first working slice, not the finished product.

What it does now:

- stores the prompt-runner base URL and optional bearer token in the browser
- drafts a prompt manifest from form fields instead of requiring manual JSON editing first
- previews the generated manifest before upload
- stores a manifest through `POST /manifests`
- creates a hosted job through `POST /jobs`
- lists manifests and jobs from the control plane
- shows per-job logs and exposes cancel for queued or running jobs
- surfaces prompt-runner reachability and common failures such as auth problems or quota conflicts

What it does not do yet:

- live log streaming
- manifest revision history and diffing
- profile discovery from the runner
- multi-job filtering, search, or owner views
- job retry, clone, or relaunch flows
- first-class remote deployment UX beyond direct control-plane access

## Execution Model

The control plane uses a supervised child-process model.

1. `POST /jobs` stores a queued job record.
2. The control plane spawns a separate `prompt-runner worker` process.
3. The worker loads the manifest and job record from disk.
4. The worker resolves operator-managed model credentials.
5. The worker registers a hero and drives turns only through the public API.
6. The worker writes status and logs back to the control-plane data store.

This keeps prompt execution out of the Go engine and makes the worker replaceable without changing the server.

## Data Model

Manifest records:

- `id`: stable manifest identifier
- `ownerId`: authoritative owner id used for quotas
- `revision`: control-plane managed revision number
- `createdAt`
- `updatedAt`
- `manifest`: validated prompt manifest with authoritative metadata fields rewritten

Job records:

- `id`
- `manifestId`
- `ownerId`
- `status`: `queued`, `running`, `completed`, `failed`, `cancelled`
- `connection`: public server connection options
- `hero`: derived hero registration payload
- `attempts`: submitted-turn count
- `consecutiveFallbacks`
- `selectedModel`: resolved operator profile or direct provider config
- `lastBoardId`
- `lastTurn`
- `terminalState`
- `failureCode`
- `failureMessage`

Logs:

- one JSONL file per job under `logs/`
- entries include `timestamp`, `level`, `message`, and optional structured `data`

## API

`GET /health`

- returns manifest count, job count, active job count, and data directory

`GET /manifests`

- lists stored manifests

`POST /manifests`

- accepts either a raw manifest body or `{ "manifest": { ... } }`
- optional wrapper fields: `manifestId`, `ownerId`

`GET /manifests/:id`

- returns a stored manifest record

`GET /jobs`

- lists job records

`POST /jobs`

- creates and dispatches a worker job
- request body:

```json
{
  "manifestId": "treasure-mind",
  "connection": {
    "baseUrl": "http://127.0.0.1:3000"
  },
  "hero": {
    "name": "Hosted Treasure Mind"
  },
  "requestedBy": "operator"
}
```

`GET /jobs/:id`

- returns job status and resolved metadata

`GET /jobs/:id/logs`

- returns structured execution logs

`POST /jobs/:id/cancel`

- marks a queued or running job as cancelled in the control-plane store

If `PROMPT_RUNNER_ADMIN_TOKEN` is set, every endpoint except `/health` requires `Authorization: Bearer <token>`.

## Operator Configuration

Service configuration:

- `PROMPT_RUNNER_HOST`: bind host, default `127.0.0.1`
- `PROMPT_RUNNER_PORT`: bind port, default `4010`
- `PROMPT_RUNNER_DATA_DIR`: persistent state directory, default `tmp/prompt-runner`
- `PROMPT_RUNNER_ADMIN_TOKEN`: optional bearer token for control-plane access
- `PROMPT_RUNNER_MAX_MANIFEST_BYTES`: request body limit for manifest uploads, default `65536`
- `PROMPT_RUNNER_MAX_ACTIVE_JOBS`: global concurrent queued/running job limit, default `8`
- `PROMPT_RUNNER_MAX_ACTIVE_JOBS_PER_OWNER`: per-owner queued/running job limit, default `2`

Model profile configuration:

- `PROMPT_RUNNER_MODEL_PROFILES_FILE`: path to a JSON file mapping profile names to provider settings
- `PROMPT_RUNNER_MODEL_PROFILES_JSON`: inline JSON alternative for the same mapping

Example profile file:

```json
{
  "balanced-production": {
    "provider": "openai",
    "model": "gpt-4.1-mini",
    "apiKeyEnv": "OPENAI_API_KEY"
  },
  "local-ollama": {
    "provider": "ollama",
    "model": "qwen2.5:7b-instruct",
    "baseUrl": "http://127.0.0.1:11434/v1",
    "includeReasoning": false
  }
}
```

Provider credential resolution order:

1. profile `apiKey`
2. profile `apiKeyEnv`
3. provider-specific env var such as `OPENAI_API_KEY` or `GROQ_API_KEY`
4. `OPENAI_COMPATIBLE_API_KEY` for `openai-compatible`
5. `OPENAI_API_KEY` as a final fallback for OpenAI-compatible providers

Base URL resolution order:

1. profile `baseUrl`
2. provider-specific env var such as `OPENAI_BASE_URL`
3. built-in known provider base URL

## Development Plan

The prompt runner should become the easiest path for prompt-authored play, while the game server at `:3000` remains the simplest way to watch and operate a board locally.

### Phase 1: First Browser Workflow

Status: shipped in the initial dashboard `Hosted Agents` tab.

- connect the dashboard to prompt runner from the browser
- draft a manifest from structured form fields
- preview the generated manifest JSON
- store a manifest and launch a hosted job without leaving the dashboard
- inspect jobs, logs, and quota-related failures in one place

### Phase 2: Better Prompt Authoring

- add richer prompt templates for common agent archetypes
- validate manifests in the browser before upload with clear field-level errors
- support import/export so operators can move between dashboard editing and repo-managed JSON files
- expose model profile guidance in the UI so authors understand which profiles are available
- support saving draft prompts locally before submission

### Phase 3: Better Hosted Operations

- add retry, duplicate, cancel, and relaunch flows directly from the jobs list
- add filtering by owner, board, status, and manifest id
- show clearer quota accounting, including which active jobs are consuming the current owner budget
- add log tailing and better failure summaries for malformed output, timeout, and unsafe-output fallback chains
- add links from a hosted job to the hero currently attached on the active board

### Phase 4: Review And Safety

- add a review state for manifests before they are eligible for launch
- add manifest revision history and diff views
- add clearer secret and model-credential separation in the operator UX
- add policy hooks for what kinds of prompts or tool policies are allowed in a deployment

### Phase 5: Productized Remote Use

- make remote prompt-runner deployments easier to connect safely from the dashboard
- add a cleaner browser-first story for teams running the control plane outside the local machine
- add richer observability for multi-board or multi-operator environments
- evaluate a proxy or gateway path when direct browser-to-runner access is not the right deployment shape

## Secrets And Isolation

- manifests are validated to reject obvious secret-bearing fields and values
- secrets stay in operator config, not in the uploaded manifest
- workers never get privileged engine access; they only use the public HTTP API
- job logs are stored outside the Go engine process

## Quotas And Abuse Guards

- manifest uploads are size-limited
- job creation is blocked when global or per-owner concurrent job quotas are reached
- tool requests remain declarative only; the runner does not dynamically grant new tools
- unsafe or malformed model output degrades to manifest-defined fallback behavior

## Failure Handling

Turn-level failure behavior is deterministic and manifest-controlled:

- timeout: `fallback.onTimeout`
- malformed output: `fallback.onMalformedOutput`
- unsafe output: `fallback.onUnsafeOutput`

Worker-level failures mark the job as `failed` with `failureCode` and `failureMessage`.

If consecutive fallback turns exceed `runner.maxConsecutiveFallbacks`, the worker fails the job rather than silently degrading forever.

## Running It

Start the game server first.

Then start the control plane:

```bash
npm run run:prompt-runner
```

Control-plane validation and regression tests:

```bash
npm run test:prompt-runner
```

Store the example manifest:

```bash
curl -X POST http://127.0.0.1:4010/manifests \
  -H "Content-Type: application/json" \
  --data-binary @docs/PROMPT_MANIFEST.example.json
```

Create a job against the public server:

```bash
curl -X POST http://127.0.0.1:4010/jobs \
  -H "Content-Type: application/json" \
  --data '{
    "manifestId": "treasure-mind",
    "connection": { "baseUrl": "http://127.0.0.1:3000" },
    "requestedBy": "operator"
  }'
```

Inspect status and logs:

```bash
curl http://127.0.0.1:4010/jobs
curl http://127.0.0.1:4010/jobs/<job-id>
curl http://127.0.0.1:4010/jobs/<job-id>/logs
```
