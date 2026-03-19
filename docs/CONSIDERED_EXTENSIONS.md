# Considered Extensions

This document tracks mechanics that are intentionally not part of the current implementation but are plausible future additions.

## Scry Mechanic

### Goal

Add a deliberate information-gathering action without giving bots or players omniscient full-map access.

### High-level shape

- `scry` would be an explicit legal action or consumable-driven action.
- It would reveal information outside normal local vision.
- It would have a real tradeoff such as spending a turn, consuming an item, increasing fatigue, or paying gold.

### Why it is interesting

- Preserves fog-of-war and exploration pressure.
- Gives strategic bots a way to invest in information rather than raw combat tempo.
- Creates a middle ground between strict local vision and unrealistic full-map omniscience.

### Plausible variants

- targeted reveal: choose a nearby coordinate or room-sized area to reveal
- directional reveal: reveal a corridor or cone in one direction
- rumor reveal: disclose the direction of the nearest shrine, exit, or treasure cluster
- monster sense: reveal hostile entities but not all terrain

### Core design constraints

- The action should never invalidate the importance of exploration.
- The revealed data should be bounded and easy to explain in the UI.
- The cost should be large enough that scrying is situational, not mandatory every run.
- If implemented for bots, the same mechanic should be available through legal actions rather than hidden API privileges.

### Recommended implementation direction

If this is added, prefer a legal-action based approach over a special out-of-band API query. That keeps the engine authoritative, preserves fairness, and lets bots reason through the same action interface they already use for movement, combat, items, and interaction.

---

## Bot Slot Rotation Strategy

### Goal

Allow users to launch more bot instances than configured slots without immediately crashing the unconfigured ones.

### Problem

`npm run dev:duel:aibot` launches 10 bot processes (slots A–J). If only A, B, C are configured in `.env`, slots D–J throw a startup error. The current options are: configure all 10 slots, or only launch as many processes as you have slots.

### Proposed extension

Add a `AIBOT_SLOT_OVERFLOW` setting that controls what happens when a slot is not configured:

- `error` (current default): crash if the slot has no config — explicit and debuggable
- `cycle`: wrap around through the configured slots in order. Slot D reuses A config, E reuses B, etc.
- `clamp`: all unconfigured slots fall back to the last configured slot
- `skip`: unconfigured slots exit immediately without error and without registering a hero

### Why it is interesting

- Makes the 10-slot duel preset usable without filling all slots.
- `cycle` is the most natural for duels: you get proportional representation across your configured models.
- `skip` is useful for dry runs or partial experiments where you want to fill fewer board slots.

### Design constraints

- The overflow strategy should only apply at process startup, not mid-game.
- The inferred slot name and bot label should clearly indicate which source config was used (e.g. `Groq-Llama70-A[D]` meaning slot D running A config).
- The `.env` explicit slot config should always take priority over any fallback.

### Recommended direction

Implement `cycle` as the fallback for `dev:duel:aibot` and expose the strategy as `AIBOT_SLOT_OVERFLOW=cycle|clamp|skip|error`. Default to `error` to preserve the explicit-config behavior for production runs.
