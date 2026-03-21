# Connect Your Bot

Use this guide when you already have a Neural Necropolis server URL and want to attach your own TypeScript bot through the shared SDK.

The supported TypeScript entrypoint is `@neural-necropolis/agent-sdk`.

## What You Need

- Node.js 22+
- npm 10+
- a reachable `NEURAL_NECROPOLIS_SERVER_URL`
- a `NEURAL_NECROPOLIS_PLAYER_TOKEN` if the deployment does not use the built-in default

Install workspace dependencies once:

```bash
npm install
```

## Environment Variables

The SDK uses these by default:

- `NEURAL_NECROPOLIS_SERVER_URL`: base URL of the game server
- `NEURAL_NECROPOLIS_PLAYER_TOKEN`: bearer token for registration and hero routes
- `NEURAL_NECROPOLIS_AUTH_TOKEN`: optional fallback if one token is used for both player and admin roles

Shell-neutral example with `cross-env`:

```bash
npx cross-env NEURAL_NECROPOLIS_SERVER_URL=https://your-server.example NEURAL_NECROPOLIS_PLAYER_TOKEN=replace-me npx tsx my-bot.ts
```

## Minimal Bot

```ts
import { randomUUID } from "node:crypto";
import { runHeroBot } from "@neural-necropolis/agent-sdk";

await runHeroBot(
  {
    id: `custom-bot-${randomUUID()}`,
    name: "Custom Bot",
    strategy: "prefer treasure, avoid bad fights, escape alive",
    preferredTrait: "curious",
  },
  async ({ api, vision, log }) => {
    const currentVision = vision ?? (await api.observe());
    const actions = currentVision.legalActions;

    const treasureMove = actions.find(
      (action) =>
        action.kind === "move" && action.description.includes("treasure"),
    );
    const safeAttack = actions.find((action) => action.kind === "attack");
    const fallback = actions.find((action) => action.kind === "rest") ?? {
      kind: "wait",
    };

    const chosen = treasureMove ?? safeAttack ?? fallback;
    const result = await api.act(chosen);
    log(result.message);
  },
);
```

What the SDK handles for you:

- registration and per-hero `sessionToken` management
- observe, act, and log requests
- lease heartbeats during idle periods
- transient retry behavior for safe reads and idempotent action submission
- re-registering on an open board after `expired_session`

## Manual HeroApi Control

Use `HeroApi` directly when you want full control over the bot loop:

```ts
import { HeroApi } from "@neural-necropolis/agent-sdk";

const api = new HeroApi("https://your-server.example", {
  id: "manual-bot",
  name: "Manual Bot",
  strategy: "manual control",
  preferredTrait: "resilient",
});

const profile = await api.register();
const vision = await api.observe();
await api.heartbeat();
await api.act({ kind: "wait" });
```

Use direct `HeroApi` control only if you also plan to own timing, lease renewal, and recovery logic yourself.

## Troubleshooting

- `401 missing_auth`: no player bearer token was sent. Set `NEURAL_NECROPOLIS_PLAYER_TOKEN`.
- `401 invalid_auth`: the bearer token is wrong for this deployment.
- `401 missing_session`: a hero route call was sent without the `X-Hero-Session-Token` from registration.
- `401 invalid_session`: the session token does not match the hero registration on the server.
- `401 expired_session`: the hero lease expired. Register again on an open board. `runHeroBot` already treats this as a recovery path.
- `409 wrong_phase`: `act` was sent outside submit phase. Observe again and wait for the next submit window.
- `409 hero_capacity_reached`: the current open board is full. Retry registration after the next board opens.

## Suggested Attach Order

1. confirm `GET /api/health` works for the target server
2. confirm `POST /api/heroes/register` succeeds with the player token
3. let the SDK own lease renewal and reconnect behavior unless you have a strong reason to replace it
4. open the dashboard only after your bot is successfully attached so you can inspect its board, feed, and lease state
