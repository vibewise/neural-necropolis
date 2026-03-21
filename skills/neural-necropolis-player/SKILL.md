---
name: neural-necropolis-player
description: Play the local Neural Necropolis dungeon game through the repo's HTTP hero API using the repo's OpenClaw bridge commands.
---

Use this skill when the user wants OpenClaw to play Neural Necropolis running from this workspace.

Rules:

- Use the repo helper commands instead of hand-written curl calls.
- Always start with `run:openclaw:bootstrap` so you know whether the game is paused and which board you joined.
- Always base decisions on the latest `run:openclaw:bootstrap` or `run:openclaw:step` output.
- Submit only one exact legal action from the latest `legalActions` array.
- If the board is not started yet, wait and poll again instead of inventing actions.
- If the hero is dead or the board completed, `run:openclaw:step` will auto-register a fresh run.

Prerequisites:

- The game server must already be running from this workspace.
- Default local server URL is derived from `PORT` or `NEURAL_NECROPOLIS_SERVER_URL`.
- If the game is on a different URL, pass `--base-url <url>` on the first register or step call.

Commands:

```bash
npm run run:openclaw
npm run run:openclaw:register -- --session claw --name "OpenClaw Raider" --trait curious
npm run run:openclaw:bootstrap -- --session claw
npm run run:openclaw:step -- --session claw
npm run run:openclaw:act -- --session claw --kind move --direction north
npm run run:openclaw:act -- --session claw --kind attack --target-id <monster-id>
npm run run:openclaw:act -- --session claw --kind use_item --item-id <item-id>
npm run run:openclaw:act -- --session claw --kind interact --target-id <target-id>
npm run run:openclaw:act -- --session claw --kind rest
npm run run:openclaw:act -- --session claw --kind wait
npm run run:openclaw:reset -- --session claw
```

Turn loop:

1. Run `npm run run:openclaw:bootstrap -- --session claw`.
2. Read `server.paused`, `queue.activeBoard`, `queue.nextJoinableBoard`, `join`, `actionNeeded`, `turnState`, `hero`, `recentEvents`, visible entities, and `legalActions`.
3. If `actionNeeded` is `true`, choose one exact legal action and submit it with `npm run run:openclaw:act`.
4. Otherwise poll with `npm run run:openclaw:step -- --session claw` until the board starts or the turn changes.
5. Repeat until the user tells you to stop.

Mode boundary:

- `npm run run:openclaw` starts the engine plus the OpenClaw gateway for fully agentic sessions.

Decision discipline:

- Favor survival over greedy plays when HP is low or multiple monsters are visible.
- Prefer actions that move toward loot or exits only when the tactical risk is acceptable.
- Do not reuse a stale legal action after the turn changes; poll with `run:openclaw:step` again first.
- Treat `queue.nextJoinableBoard` as the canonical pre-join scan result for the first run.
