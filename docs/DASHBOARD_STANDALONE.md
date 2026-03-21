# Standalone Dashboard

Use this when you want to host the Neural Necropolis dashboard separately from the Go server binary.

If you are already opening `http://127.0.0.1:3000` for a local game, you do not need this.

The dashboard is still just a browser client. It talks to the public spectator routes and the admin routes over HTTP. It does not require engine-internal access.

## Should Most Users Care?

Usually, no.

For most local runs, the server-served dashboard at `http://127.0.0.1:3000` is the correct UI and the only dashboard you need.

Keep the standalone dashboard only if you care about at least one of these:

1. separate UI hosting from the Go binary
2. cross-origin browser testing
3. deploying the UI independently from the server later
4. smoke-testing the extracted static dashboard package

## What Exists

- extracted static package: `packages/dashboard-static`
- server-served dashboard source: `engine/server/dashboard.html`
- browser-configurable API base via `?server=https://your-server.example`
- browser-stored admin token for operator controls
- cross-origin support in the Go server for dashboard fetches and admin preflight requests
- standalone smoke test that validates the host path against a live server

## Primary Workflow

1. start or obtain a Neural Necropolis server URL
2. serve the dashboard package
3. open the standalone dashboard with the target server in the query string
4. enter an admin token in the UI only if you need write access for turns or settings

Local example:

```bash
npm run run:engine
npm run run:dashboard:serve
```

Then open:

```text
http://127.0.0.1:4321/?server=http://127.0.0.1:3000
```

The exact standalone port is printed by the dashboard-static server when it starts.

## URL And Auth Semantics

- `?server=...` sets the target API server for the dashboard runtime
- the chosen API server is stored only in that browser
- the admin token is also stored only in that browser
- read-only dashboard views do not require an admin token
- mutating controls such as turns and settings require a valid admin token

The embedded dashboard and the standalone dashboard share the same client behavior until a future dedicated frontend rewrite changes that on purpose.

## Cross-Origin Requirements

The Go server now exposes the headers needed for the standalone dashboard path:

- `Access-Control-Allow-Origin: *`
- `Access-Control-Allow-Methods: GET, POST, OPTIONS`
- `Access-Control-Allow-Headers: Accept, Authorization, Content-Type, Idempotency-Key, Last-Event-ID, X-Hero-Session-Token, X-Request-Id`
- `Access-Control-Expose-Headers: X-Request-Id`

That is what makes admin preflight requests and request-id visibility work from a separately hosted dashboard origin.

## Commands

- `npm run sync:dashboard-static`: copy the current embedded dashboard HTML into the standalone package
- `npm run run:dashboard:serve`: serve the extracted dashboard package locally
- `npm run test:dashboard:smoke`: boot the standalone host, probe a target server, and verify the cross-origin contract

Example smoke run:

```bash
npx cross-env NEURAL_NECROPOLIS_SERVER_URL=http://127.0.0.1:3000 npm run test:dashboard:smoke
```

## What This Means For Users

- spectators can use the dashboard from a separate host without bundling it into the Go binary
- operators can keep the dashboard read-only by not entering an admin token
- deployments can move the UI independently of the authoritative game server

## Current Boundary

This is a packaging split, not a new privileged app tier.

The game server remains authoritative for:

- board state
- turn state
- event stream
- admin mutations

The standalone dashboard remains an ordinary web client of those APIs.
