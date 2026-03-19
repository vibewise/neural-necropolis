# Neural Necropolis Game Mechanics

This document is the implementation-level rules reference for Neural Necropolis as currently enforced by the Go engine.

It is intended to be read as both:

- a player and spectator handbook
- a parameterized behavior reference for bot authors

If this document and the engine diverge, the engine is authoritative and this file should be updated.

## 1. Game Overview

Neural Necropolis is a turn-based competitive dungeon run. Multiple heroes enter a generated board, compete for score, fight monsters, interact with non-hostile entities, and try to finish with the best total score before the board ends.

The game is not fully simultaneous. Heroes submit actions during a planning window, then the engine resolves those actions in a fixed order.

## 2. Default Runtime Parameters

These are the default gameplay and board parameters currently used by the engine.

### Board parameters

- map width: 48
- map height: 32
- target room count: 9
- max heroes per board: 4
- min heroes to auto-start a board: 4
- prepared board queue target: 10
- max turns per board: 20
- base vision radius seed value: 3
- max retained events per board feed: 80

### Timing parameters

These are server defaults. Scripts may override them through environment variables.

- submit window: 12000 ms by default
- resolve window: 500 ms by default
- board warm-up: 0 ms by default

The commonly used AI duel preset overrides the submit window to 8000 ms and keeps resolve at 500 ms.

### Core hero values

Base hero stats before trait bonuses:

- max HP: 40
- current HP at spawn: 40
- attack: 5
- defense: 3
- speed: 3
- perception: 5
- starting morale: 50
- starting fatigue: 0
- starting gold: 0

### Fatigue parameters

- fatigue per surviving turn: +1
- extra fatigue after combat action: +1
- extra fatigue from shallow water movement: +2
- fatigue reduction from rest: -8
- fatigue reduction from wait: -2
- fatigue penalty threshold 50: -1 attack and defense
- fatigue penalty threshold 75: -2 attack and defense
- fatigue penalty threshold 100: -3 attack and defense
- fatigue cap: 100

### Morale parameters

- starting morale: 50
- morale from kill: +5
- morale from treasure: +3
- morale from shrine: +10
- morale from taking damage: -2
- morale from ally death event: -5
- morale from poison application: -3
- morale high threshold: above 70 gives +1 attack
- morale low threshold: below 30 gives -1 attack and -1 defense
- morale bounds: 0 to 100

### Healing and hazard parameters

- rest heal: 5 HP
- health potion heal: 20 HP
- shrine heal: 15 HP
- hidden trap damage: 8 HP
- visible trap damage: 4 HP
- lava damage: 10 HP per step onto lava tile

### Inventory and vision parameters

- inventory limit: 8 items
- trap auto-reveal perception threshold: 7
- Scroll of Reveal radius: 6 tiles in both x and y directions around the hero

### Scoring parameters

- treasure tile score: +10
- escape bonus: +50
- exploration score contribution on leaderboard: floor of tiles explored / 10
- survival score contribution on leaderboard: floor of turns survived / 5

### Dynamic monster maintenance

- if living monsters drop below 4 at end of resolution, the engine attempts a spawn wave
- spawn chance when below threshold: 50%

## 3. Board Lifecycle

Each board is always in one of four lifecycle states:

- queued
- open
- running
- completed

### Queued

The board has been generated and reserved for a future run.

### Open

The board accepts hero registration but is not yet resolving turns.

An open board reports one of these lobby states:

- waiting for heroes
- waiting for more heroes
- warm-up before start
- ready to start

### Running

Turns actively cycle between submit and resolve windows.

### Completed

The board is over and remains visible in history.

## 4. When Boards Start And End

### Start conditions

A board auto-starts when all of the following are true:

- the board is open
- no other board is currently running
- at least 4 heroes are attached
- any global warm-up delay has expired
- the server is **not paused** (see §8a)

### Pause control — on/off toggle

The server starts in a **paused** state by default. The dashboard header contains
a single on/off toggle switch labelled **Turns ON** / **Turns OFF**.

- **Turns OFF** (default on startup): auto-start polling is suspended — no
  boards will start. If a board is already running, the current turn's
  submit→resolve cycle finishes, but no new turn begins afterward.
- **Turns ON**: the auto-start loop resumes. If no board is running and one is
  ready (meets the start conditions above), the server starts it immediately.

### End conditions

A board ends when either of these is true:

- the turn counter reaches the board turn limit, default 20
- all heroes are finished, meaning every hero is either dead or escaped

When a board ends, the server records a completion reason and appends a winner summary.

## 5. Dungeon Generation

Each board is generated from a seed.

### Map shape

- full map size is 48 x 32
- the map begins as solid walls
- the engine attempts to place 9 non-overlapping rooms
- room size is randomly chosen from width 5 to 9 and height 5 to 7
- if generation produces fewer than 3 rooms, the engine falls back to three fixed rooms

### Room roles

The generated room list is then typed as follows:

- first room: spawn room
- last room: boss lair
- second-to-last room if enough rooms exist: treasure vault
- up to one shrine room
- up to one merchant room
- up to one prison room
- all remaining rooms: normal rooms

### Corridors and doors

- rooms are connected in sequence by carved corridors
- if enough rooms exist, an extra corridor is carved from the first room to the midpoint room for added connectivity
- door placement is probabilistic on room boundaries at floor-to-floor transitions
- standard door chance: 40%
- boss lair and treasure vault doors may become closed or locked

### Traps

- corridor floor tiles tracked during carving have an 8% chance to become hidden traps

### Room contents

Treasure vault:

- 3 to 5 treasure tiles
- 1 to 2 ordinary chests
- 0 to 1 locked chests
- 2 to 3 monsters chosen from orc, skeleton, mimic
- 2 to 3 floor equipment items

Boss lair:

- 1 to 2 treasure tiles
- 1 locked chest
- 1 dragon
- 1 rare floor item
- 40% chance to place 2 to 3 lava tiles
- exit tile is placed in the boss room

The exit is always in the last generated room. The boss room also contains the dragon and at minimum one locked chest. To reach the exit a hero must navigate to that room, which is the deepest part of the dungeon. The boss room door may be closed or locked. The dragon guards the area but does not block the exit tile itself; a hero can step onto the exit without killing the dragon first.

Escaping grants +50 score immediately. A hero that escapes can no longer act but remains on the leaderboard. The board does not end until the turn limit is hit or all heroes are finished.

Prison room:

- 1 prisoner NPC
- 1 to 2 monsters chosen from skeleton, orc

Shrine room:

- 1 shrine NPC
- no monsters are generated directly in this room

Merchant room:

- 1 merchant NPC
- no monsters are generated directly in this room

Normal room:

- 1 to 3 monsters chosen from goblin, goblin, spider, skeleton
- 50% chance to place 1 to 2 treasure tiles
- 40% chance to place 1 potion tile
- 35% chance to place one floor item from the equipment plus potion/key pool
- 20% chance to place 2 to 4 shallow water tiles

Corridors:

- up to 3 potion tiles may be scattered with 3% chance checks over corridor tiles

## 6. Hero Creation, Reconnection, And Respawn

### New hero registration

When a new hero registers:

- the requested trait is used; if none is supplied, the default trait is curious
- trait bonuses modify the base stat line immediately
- the hero is placed on a random free floor tile not occupied by heroes, monsters, or NPCs
- the hero starts alive with empty inventory and no equipment

### Trait bonuses

Traits adjust the base stat line at hero creation and also serve as a behavioral hint for AI bots. The engine enforces the stat delta; the behavioral interpretation is a convention that AI bots and bot authors use to tune decision-making.

Aggressive:

- attack +2
- defense -1
- gameplay: suited for early combat; low defense means taking more damage in extended fights

Cautious:

- defense +2
- max HP +10
- perception +1
- gameplay: durable and harder to kill; sees farther; slower to accumulate kills but more likely to survive to late turns

Greedy:

- perception +1
- speed +1
- gameplay: can move first in resolution (speed advantage), sees slightly farther; designed to rush treasure and exits before other heroes

Curious:

- perception +2
- speed +1
- gameplay: the best explorer; sees the widest area, moves early in resolution; well-suited to finding the exit and mapping the dungeon quickly

Resilient:

- max HP +15
- defense +1
- gameplay: the tankiest baseline; survives punishment better than any other trait; effective for grinding monster XP over many turns

### Rescue quest assignment on registration

If the board contains a prisoner NPC, every newly registered hero receives a rescue quest for that prisoner:

- objective: rescue that NPC
- reward: +25 score and +15 gold

### Re-registering an existing hero ID

If the same hero ID registers again on the same board:

- if the hero is alive or escaped, the engine treats it as a reconnect and sets last action to `reconnected`
- if the hero is dead, the engine respawns it on a new free floor tile with base stats, no equipment, no inventory, no effects, zero fatigue, morale reset to 50, and gold cut in half

This respawn behavior is implementation-defined and belongs to the current board, not to a new board.

### Bot mission hint

Mission is a bot-layer convention. The engine does not enforce a mission; it is used by AI bots to tune prompt behavior. Three defined missions currently used in AI bot configuration:

**combat**
Prioritize fighting monsters. Lean into kill score and morale gains from combat. Accept higher risk in exchange for XP. Works best on aggressive and resilient traits. Less effective if the hero is already at critical HP or severely fatigued.

**escape**
Prioritize reaching the exit. Avoid unnecessary fights. Prefer movement toward unexplored rooms and pointers toward the boss lair. The exit is always in the boss room, so escape-mission bots should navigate toward it actively. Works best on greedy and curious traits because of their speed and perception advantages.

**balanced**
No strong lean. Take fights when they are clearly favorable, collect treasure opportunistically, and pursue the exit once it is likely visible or nearby. The default for bots that do not have a clear stat advantage in either combat or movement.

## 7. Hero State Fields That Matter In Play

Each hero tracks at least these gameplay-relevant values:

- HP and max HP
- attack
- defense
- speed
- perception
- position
- score
- kills
- tiles explored
- gold
- inventory
- equipped weapon, armor, accessory
- active status effects
- fatigue
- morale
- status: alive, dead, escaped
- turns survived
- last action summary

## 8. Vision And Player Information

Heroes do not observe the full board through the public bot API.

### Vision radius

Vision radius is:

`3 + floor(perception / 2)`

If the hero is blinded, the radius is halved and floored to at least 1.

### What a hero can observe

An observation includes:

- hero state
- visible tiles
- visible monsters
- visible other living heroes
- visible NPCs
- visible floor items
- up to the most recent 8 events
- the authoritative legal action list for the current state

### Hidden trap visibility rule

If a tile is a hidden trap and the hero's perception is below 7, that tile is reported as floor in vision.

At perception 7 or above, hidden traps are shown as hidden traps.

## 8a. Prompt Information Modes (Game Settings)

The server exposes a set of **game settings** that control how much extra
information each bot receives in its prompt. These settings are global — they
affect every bot equally on every board, guaranteeing fairness. They can be
changed at any time from the dashboard Settings tab or via the
`/api/admin/settings` endpoint.

### Mode A — Vision Only (default)

Only the standard observation data described in §8 is included in the prompt.
This is the baseline mode.

### Mode B — Vision + Landmarks

When `includeLandmarks` is enabled, the observation additionally contains an
array of **up to 10 map landmarks**. Landmarks are notable board features that
exist regardless of vision range:

| Landmark kinds |
| -------------- |
| shrine         |
| exit           |
| treasure       |
| chest          |
| chest_locked   |
| merchant       |
| lava           |
| NPC (by name)  |

The list is **deterministic per board** — every bot on the same board receives
the exact same set of landmarks in the same order. The bot prompt formats each
landmark with its kind, name, absolute position, and Manhattan distance from
the hero.

### Mode C — Include All Player Positions

When `includePlayerPositions` is enabled (toggle, independent of A/B), the
observation includes the **name and position of every living hero** on the
board, regardless of whether they are within vision range.

This allows bots to reason about coordination, avoidance, or competition with
other players.

### Paused flag (on/off toggle)

The `paused` setting defaults to **true** on server startup. It is controlled
by the dashboard's on/off toggle switch. When paused, auto-start is suspended
and running boards finish their current turn but do not advance further.
See §4 for full details.

### Settings API

`GET  /api/admin/settings` — returns the current `GameSettings` object.
`POST /api/admin/settings` — accepts a JSON body with any combination of:

```json
{
  "includeLandmarks": true,
  "includePlayerPositions": false,
  "paused": false
}
```

Settings take effect immediately on the next observation request.

## 9. Turn Structure

The server runs two repeating phases:

1. submit phase
2. resolve phase

### Submit phase

- living heroes may queue exactly one legal action
- a second submission in the same turn is rejected with `action already queued for turn N`
- illegal submissions are rejected

### Resolve phase

The board advances exactly one turn when `ResolveTurn` runs.

The internal board turn starts at 1. After one resolve, the board turn becomes 2.

## 10. Resolution Order

Each resolve step uses a deterministic per-turn RNG derived from `seed:turn` and then performs these steps:

1. process status effects on heroes and monsters
2. resolve hero actions in descending speed order
3. resolve monster AI turns
4. remove dead monsters
5. optionally spawn a replacement monster if living count is low
6. apply morale loss to surviving heroes if an ally was slain by a monster that turn
7. append the new events to the board event log

### Important implications

- faster heroes resolve before slower heroes
- hero choices are looked up from the original pending action map for that turn
- a target can die or move out of range before a slower hero resolves
- monsters act after heroes see the updated board state created by hero actions

## 11. Legal Actions

There are exactly six action kinds:

- move
- attack
- rest
- use_item
- interact
- wait

The legal action list is authoritative. Bots should not try to infer legality independently.

## 12. Movement Rules

Heroes may move one tile north, south, east, or west if the target is legal.

### Hero movement can enter

- floor
- open doors
- treasure
- potion tiles
- exit
- shallow water
- lava
- hidden traps
- visible traps
- triggered traps
- open chests
- shrine tiles
- merchant tiles

### Hero movement cannot enter

- walls
- locked doors without a key
- locked chests without a key
- any tile currently occupied by a living monster

### Door and chest behavior on move

Closed door:

- becomes open when entered

Locked door:

- requires one key in inventory
- consumes one key
- becomes open

Chest:

- becomes open when entered
- generates 1 item from ordinary chest loot pool
- ordinary chest loot pool: Health Potion, Rusty Key, Antidote

Locked chest:

- requires one key in inventory
- consumes one key
- becomes open
- generates 1 to 2 items from rare chest loot pool
- rare chest loot pool: Health Potion, Rusty Key, Scroll of Reveal, Iron Sword, Chain Mail, Amulet of Warding

If inventory is full, chest-generated items beyond capacity are silently not added.

### Tile effects on landing

Treasure tile:

- hero score +10
- morale +3
- tile becomes floor

Potion tile:

- if inventory has room, add one Health Potion item
- tile becomes floor

Exit tile:

- hero status becomes escaped
- hero score +50

Hidden trap:

- hero takes 8 damage
- tile becomes triggered trap
- if HP drops to 0 or below, hero dies

Visible trap:

- hero takes 4 damage
- tile becomes triggered trap
- if HP drops to 0 or below, hero dies

Lava:

- hero takes 10 damage
- tile remains lava
- if HP drops to 0 or below, hero dies

Shallow water:

- hero fatigue +2 immediately from terrain

### Floor item pickup after movement

After a successful move, floor items on the destination tile are resolved.

If the item has an equipment slot and the hero has nothing equipped in that slot:

- the item is auto-equipped immediately

Otherwise:

- if inventory has room, the item is added to inventory

If inventory is full and the item would not auto-equip, it is not taken.

Each successful move increments `tiles explored` by 1.

## 13. Attack Rules

Heroes may attack a living monster at Manhattan distance 1 or less.

Heroes cannot attack other heroes. There is no player-versus-player combat action in the current engine.

### Hero attack formula

Hero effective attack:

- start from current attack stat
- apply fatigue penalties at 50, 75, 100 fatigue
- if morale is above 70, add 1 attack
- if morale is below 30, subtract 1 attack
- minimum effective attack is 1

Monster effective defense for hero attacks:

- start from monster defense
- add shield magnitudes if present
- minimum effective defense is 0

Damage dealt:

- `hero effective attack - monster effective defense + random(0..2)`
- minimum final damage is 1

### On kill

When a hero kills a monster:

- hero score increases by the monster XP reward
- hero gold increases by the monster gold drop
- hero kills increases by 1
- hero morale increases by 5

Monster drops are rolled independently with 50% chance per listed drop kind.

### Kill quests

If the hero has an incomplete kill quest matching the monster kind:

- quest progress increments by 1
- if progress reaches target count, the quest completes
- the hero receives the quest reward score and gold immediately

## 14. Rest And Wait

### Rest

- heals up to 5 HP, capped by missing HP
- reduces fatigue by 8
- does not attack or move

### Wait

- reduces fatigue by 2
- does not heal

## 15. Item Use Rules

The action is `use_item`.

The chosen item must be present in inventory at resolution time.

### Consumables

Health Potion:

- consumed on use
- heals up to 20 HP, capped by missing HP

Antidote:

- consumed on use
- removes poison effects only
- preserves other effects

Rusty Key:

- consumed on use
- currently does not unlock anything directly through `use_item`
- last action becomes `used key (nothing to unlock here)`

Scroll of Reveal:

- consumed on use
- reveals all hidden traps in a square of radius 6 around the hero
- each hidden trap in that area becomes a visible trap

Scroll of Teleport:

- consumed on use
- attempts up to 200 random floor-tile teleports
- target tile must be floor
- target tile must not be occupied by a living monster
- the engine does not separately reject occupied hero tiles here, so the chosen destination is governed by the current floor and monster checks

### Equipment use

Equippable items are removed from inventory and equipped.

Slots:

- weapon
- armor
- accessory

If an existing item is already in that slot:

- the old item is returned to inventory
- old stat bonuses are removed
- new stat bonuses are applied

If max HP changes and current HP would exceed the new max, current HP is clamped down to the new max.

## 16. NPC Interaction Rules

An NPC may be interacted with when Manhattan distance is 1 or less.

Each NPC can only be interacted with once per hero. Repeated interaction by the same hero is blocked.

### Shrine

- heal up to 15 HP
- add shield effect with magnitude 3 for 3 turns
- morale +10

### Merchant

- merchant starts with fixed stock: 2 Health Potions, 1 Antidote, 1 Rusty Key, 1 Scroll of Reveal, 1 Scroll of Teleport
- the hero buys the single most expensive affordable item
- the hero must also have at least one free inventory slot
- if no item is affordable or inventory is full, the interaction succeeds but results in `merchant: nothing affordable`

### Prisoner

- marks the hero as having freed that prisoner
- if the hero has the matching rescue quest, the hero gains +25 score and +15 gold from the quest reward and the quest completes
- otherwise, the hero gains a flat rescue bonus of +15 score and +10 gold

## 17. Status Effects

The engine defines these effect kinds:

- poison
- stun
- shield
- haste
- regen
- blind

### Effects currently processed over time

Poison:

- deals its magnitude in damage each turn before actions

Regen:

- restores its magnitude in HP each turn before actions

Shield:

- increases effective defense by its magnitude while active

Stun:

- prevents the hero from acting for that turn

Blind:

- reduces vision radius by half, minimum 1

Haste:

- defined in types, but currently has no direct resolution logic in the engine

Each effect loses 1 remaining turn during effect processing. Effects with 0 remaining turns are removed.

## 18. Fatigue Rules

Fatigue affects both attack and defense.

At fatigue:

- 0 to 49: no stat penalty
- 50 to 74: -1 attack and defense
- 75 to 99: -2 attack and defense
- 100 or more: -3 attack and defense

After any living hero completes a turn:

- fatigue +1 baseline
- if that hero used attack this turn, fatigue +1 extra

Because shallow water also applies +2 during move resolution, a combat turn in water-heavy terrain can stack fatigue quickly.

## 19. Morale Rules

Morale affects effective attack and defense.

At morale:

- above 70: +1 attack
- below 30: -1 attack and -1 defense

Current morale changes implemented in the engine include:

- kill: +5
- treasure: +3
- shrine: +10
- taking monster damage: -2
- being poisoned: -3
- ally slain by monster event during the turn: -5 to each surviving ally

## 20. Monsters

### Monster roster

Goblin:

- HP 8
- ATK 3
- DEF 1
- SPD 3
- XP reward 5
- gold drop 3
- behavior patrol
- alert range 5

Spider:

- HP 6
- ATK 4
- DEF 0
- SPD 4
- XP reward 4
- gold drop 2
- behavior ambush
- alert range 3
- listed drop: Antidote

Skeleton:

- HP 12
- ATK 4
- DEF 2
- SPD 2
- XP reward 8
- gold drop 6
- behavior guard
- alert range 5
- listed drop: Rusty Key

Wraith:

- HP 15
- ATK 6
- DEF 1
- SPD 4
- XP reward 12
- gold drop 8
- behavior chase
- alert range 7

Orc:

- HP 20
- ATK 6
- DEF 3
- SPD 2
- XP reward 15
- gold drop 12
- behavior guard
- alert range 5
- listed drop: Health Potion

Mimic:

- HP 18
- ATK 7
- DEF 4
- SPD 1
- XP reward 20
- gold drop 20
- behavior ambush
- alert range 2
- listed drop: Rusty Key

Dragon:

- HP 50
- ATK 10
- DEF 5
- SPD 3
- XP reward 40
- gold drop 30
- behavior guard
- alert range 6
- listed drops: Scroll of Reveal, Health Potion

### Monster movement permissions

Monsters can move on:

- floor
- open doors
- hidden traps
- triggered traps
- shallow water

Monsters do not path onto:

- walls
- closed doors
- locked doors
- chest tiles
- shrine tiles
- merchant tiles
- lava
- occupied hero tiles
- occupied monster tiles

### Monster attack formula

Monster damage is:

- `monster attack - hero effective defense + random(0..1)`
- minimum final damage is 1

On hit:

- hero morale -2

Spider additional effect:

- 40% chance to apply poison for 3 turns at magnitude 3
- morale -3 more when poison is applied

Wraith additional effect:

- 30% chance to apply blind for 2 turns

If HP drops to 0 or below from monster damage:

- hero dies
- an ally-death morale penalty can be applied to surviving allies later in the same turn

### Monster behavior rules

Chase:

- attack if adjacent
- otherwise move toward nearest living hero if within alert range
- otherwise may randomly prowl with 18% chance

Patrol:

- attack if adjacent
- otherwise move toward nearest living hero if within alert range
- otherwise may randomly patrol with 30% chance

Ambush:

- attack if adjacent
- otherwise move toward nearest living hero only when distance is 2 or less
- otherwise may randomly shift with 12% chance

Guard:

- attack if adjacent
- otherwise move toward nearest living hero if within alert range
- otherwise may randomly patrol its post with 8% chance

Flee:

- attack if adjacent
- otherwise attempt to move away from the nearest living hero

Low-HP override:

- if a non-guard monster falls below one quarter of max HP, it uses flee-style retreat behavior regardless of its normal AI
- if still adjacent while in this low-HP state, it attacks instead of moving away

## 21. Monster Respawn Maintenance

After dead monsters are removed, if living monsters are fewer than 4, the engine may spawn one replacement monster.

Spawn rules:

- 50% chance to attempt a spawn
- up to 80 random placement attempts
- spawn tile must be floor
- spawn tile must not be occupied by a living monster
- spawn tile must be more than 8 Manhattan distance away from every living hero
- replacement kind is chosen from goblin, goblin, spider, skeleton

## 22. Inventory And Equipment Reference

### Consumables and utility

Health Potion:

- value 10
- restores 20 HP

Antidote:

- value 8
- cures poison

Rusty Key:

- value 5
- consumed automatically by locked doors and locked chests

Scroll of Reveal:

- value 15
- reveals nearby traps

Scroll of Teleport:

- value 20
- teleports to a random safe floor tile

### Equipment

Iron Sword:

- weapon
- +3 attack
- value 25

Shadow Dagger:

- weapon
- +2 attack
- +1 speed
- value 20

Battle Axe:

- weapon
- +5 attack
- -1 speed
- value 30

Seer's Staff:

- weapon
- +1 attack
- +3 perception
- value 22

Leather Armor:

- armor
- +2 defense
- value 20

Chain Mail:

- armor
- +4 defense
- -1 speed
- value 35

Plate Armor:

- armor
- +6 defense
- -2 speed
- value 50

Ring of Far Sight:

- accessory
- +4 perception
- value 30

Amulet of Warding:

- accessory
- +2 defense
- +10 max HP
- value 30

Boots of Haste:

- accessory
- +3 speed
- value 28

## 23. Score And Leaderboard Math

There are two score layers to understand.

### Direct hero score field

The hero `score` field is increased directly by:

- treasure tiles: +10 each
- escape: +50
- monster kills: +monster XP reward
- quest completion rewards
- prisoner rescue fallback reward when no matching quest exists

### Separate tracked fields

- gold is tracked separately and also feeds the leaderboard
- kills are tracked separately
- tiles explored are tracked separately
- turns survived are tracked separately

### Leaderboard total score

The leaderboard `TotalScore` is calculated as:

`hero score + floor(tiles explored / 10) + floor(turns survived / 5)`

The board snapshot also exposes sub-scores:

- combat score = kills \* 5
- treasure score = gold
- exploration score = floor(tiles explored / 10)
- quest score = sum of completed quest reward scores

These sub-scores are informational. The displayed `TotalScore` is still based on the direct formula above.

## 24. Board Completion And Winner Selection

When the board ends:

- the server stops the beat loop
- the board is marked completed
- the completion reason includes the winner summary

Winner summary format:

- `Winner: <HeroName> with <TotalScore> pts.`

The winner is the top hero by leaderboard total score, regardless of whether that hero is alive, dead, or escaped at board end.

## 25. Exact User-Facing Consequences To Keep In Mind

- only one action submission is allowed per hero per turn
- heroes do not replace queued actions
- hidden traps are still walkable and can kill a hero immediately
- visible traps still trigger, they just do less damage
- lava damages on entry only
- merchants use automatic buy logic; the hero does not choose which specific merchant item to buy
- prisoners can grant either quest rewards or fallback rescue rewards depending on whether the hero has the matching rescue quest
- equipment on the floor auto-equips only when the target slot is empty
- a dead hero can be re-registered on the same board and will respawn under the current implementation
- leaderboard total score is not identical to the raw `hero.score` field

## 26. Source Of Truth Note

This file is meant to be the readable source of truth for game behavior.

It documents the current engine behavior in:

- board generation
- hero lifecycle
- legal actions
- turn resolution
- hazards
- items
- NPCs
- monsters
- scoring
- board completion

If mechanics change in the engine, this file should be updated in the same change.
