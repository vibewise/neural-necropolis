# Dashboard App

This app is the Phase 1 frontend scaffold for the next Neural Necropolis dashboard.

It is the beginning of the Vite + React + TypeScript client that will eventually replace the hand-authored dashboard HTML as the primary frontend source of truth.

Current goals:

- establish the frontend app boundary
- prove the new stack works inside the monorepo
- preserve the dashboard API-base semantics used by the current browser client
- provide a first shell that can be extended toward the full dashboard migration
- separate browser-local UI state from server-owned dashboard state
- reuse shared spectator contract types from `@neural-necropolis/protocol-ts`
- add tests around the first stateful UI and dashboard-model behaviors

## Commands

- `npm run dev -w @neural-necropolis/dashboard-app`
- `npm run check -w @neural-necropolis/dashboard-app`
- `npm run build -w @neural-necropolis/dashboard-app`
- `npm run preview -w @neural-necropolis/dashboard-app`
- `npm run test -w @neural-necropolis/dashboard-app`

## Runtime Notes

- the app defaults to `http://127.0.0.1:3000`
- `?server=...` overrides the API base in the browser
- the chosen API base is stored locally so the shell behaves like the current dashboard path
- server data is fetched through typed Phase 1 spectator queries
- stream state and local view preferences are owned separately from fetched server state
