# Prompt Manifest Contract

This document defines the artifact users upload before any hosted prompt runner exists.

The goal is to keep uploaded prompt agents declarative, reviewable, and validatable without executing arbitrary code.

Machine-readable schema:

- [PROMPT_MANIFEST.schema.json](PROMPT_MANIFEST.schema.json)

Reference example:

- [PROMPT_MANIFEST.example.json](PROMPT_MANIFEST.example.json)

## Product Rule

Uploads are manifests, not programs.

Allowed:

- agent identity and high-level strategy
- prompt text
- model selection preferences
- deterministic runner budgets
- explicit tool requests
- explicit fallback behavior
- observability metadata

Not allowed:

- API keys, bearer tokens, passwords, or secret headers
- shell scripts, JavaScript, TypeScript, Python, or executable code blobs
- arbitrary URLs for callbacks or dynamic imports
- hidden privileged engine access

Secrets and credentials are operator-managed and injected later by the hosted runner control plane.

## Manifest Shape

Required top-level fields:

- `manifestVersion`: current value is `1.0`
- `kind`: current value is `neural-necropolis.prompt-manifest`
- `agent`
- `prompts`
- `model`
- `runner`
- `io`
- `tools`
- `fallback`

Optional top-level field:

- `metadata`

## Field Semantics

### `agent`

User-supplied identity and high-level play preference.

- `displayName`: human-facing name for the uploaded agent
- `strategy`: short summary of what the agent is trying to do
- `preferredTrait`: one of the current game traits: `aggressive`, `cautious`, `greedy`, `curious`, `resilient`

### `prompts`

User-supplied prompt bundle.

- `system`: required base instruction set
- `policy`: required operational policy for tactical tradeoffs and safety
- `persona`: optional tone or role framing
- `styleNotes`: optional formatting and response-style hints

Current limits:

- `system`: at most 12000 characters
- `policy`: at most 8000 characters
- `persona`: at most 4000 characters
- `styleNotes`: at most 2000 characters

### `model`

Selection preferences for the hosted runner.

Supported selection modes:

- `profile`: preferred production shape. The user requests an operator-defined profile such as `balanced-production`.
- `direct`: explicit provider and model identifier when the product allows direct selection.

User-supplied controls:

- `temperature`: from `0` to `1`
- `maxOutputTokens`: from `32` to `512`
- `reasoningEffort`: optional `low`, `medium`, or `high`

Safe limits are intentionally narrow so the manifest maps to predictable hosted cost and latency bounds.

### `runner`

Execution budgets for one decision attempt.

- `decisionTimeoutMs`: `1000` to `60000`
- `maxDecisionRetries`: `0` to `2`
- `maxConsecutiveFallbacks`: optional, `1` to `5`
- `cooldownMs`: optional backoff between retries or fallback loops, `0` to `5000`

### `io`

Defines the hosted runner contract between game observation and model output.

Current values for `v1`:

- `inputMode`: `observation-v1`
- `outputMode`: `action-index-v1`

`action-index-v1` means the runner gives the model the current legal action list and expects the model to choose exactly one legal action by zero-based index into that list.

This maps cleanly to the current AI bot flow and avoids requiring raw engine internals in the manifest.

### `tools`

Requested tool access.

- `mode: none` means the upload requests no external tools and `allowed` must be empty.
- `mode: allowlist` means the upload requests only the tool ids listed in `allowed`.

Phase 5 does not grant any new tools automatically. This field exists so Phase 6 can enforce a narrow allowlist instead of discovering tool usage dynamically.

### `fallback`

Deterministic failure policy for the hosted runner.

Each of these must be explicit:

- `onTimeout`
- `onMalformedOutput`
- `onUnsafeOutput`

Allowed fallback actions:

- `wait`: submit or synthesize a passive wait decision
- `rest`: prefer a passive heal/recovery action when legal, otherwise degrade to the runner default passive fallback
- `first_legal`: choose the first legal action in the current list
- `reject_turn`: do not trust the model output; record the failure and let the runner apply its operator-defined safe turn rejection behavior

Recommended safe default for hosted play:

- timeout: `wait`
- malformed output: `wait`
- unsafe output: `reject_turn`

### `metadata`

Observability and audit fields.

These may be supplied by the uploader, but the hosted control plane is allowed to overwrite them with authoritative values.

- `ownerId`
- `createdBy`
- `revision`
- `labels`
- `notes`

## Upload Policy

What users may upload:

- plain-text prompt content
- model preference declarations
- budget and retry preferences within safe limits
- tool requests within the declared allowlist format
- deterministic fallback policies

What users may not upload:

- secrets
- custom code
- arbitrary network destinations
- opaque binary blobs
- custom tool definitions that bypass operator approval

## Validation Rules

The repo validator checks:

- required fields and literal version markers
- supported trait and fallback enums
- selection mode shape for `profile` vs `direct`
- timeout, retry, and token bounds
- tool mode consistency
- obvious secret-bearing fields such as `apiKey`, `token`, `secret`, `password`, or `authorizationHeader`

Run it with:

```bash
npm run validate:prompt-manifest
```

## Operator-Managed Vs User-Supplied

User-supplied:

- `agent`
- `prompts`
- `model` preferences
- `runner` budgets within limits
- `tools` requests
- `fallback`
- optional `metadata`

Operator-managed later in Phase 6:

- credential binding
- actual provider account selection
- quota enforcement
- tenant ownership and authoritative revision ids
- final tool approval
- execution environment and isolation policy

## Why This Contract Exists Before The Runner

The hosted runner should execute a reviewed manifest, not arbitrary uploaded code. Defining this contract first keeps the game engine unaware of prompt contents and keeps Phase 6 focused on orchestration, isolation, and secrets instead of schema churn.
