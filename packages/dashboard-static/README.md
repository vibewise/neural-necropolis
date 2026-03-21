# Dashboard Static Package

This package hosts the current Neural Necropolis dashboard as a standalone static site.

It intentionally mirrors [engine/server/dashboard.html](../../engine/server/dashboard.html) so the server-served dashboard and the standalone dashboard stay functionally aligned until a dedicated frontend rewrite happens.

## Commands

- `npm run sync -w @neural-necropolis/dashboard-static`: copy the current embedded dashboard HTML into `public/index.html`
- `npm run serve -w @neural-necropolis/dashboard-static`: sync, then serve the dashboard statically
- `npm run smoke -w @neural-necropolis/dashboard-static`: sync, verify a target game server, then smoke-test the standalone host path
