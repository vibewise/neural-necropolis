package game

import (
	"fmt"
	"math"
	"sort"
	"strings"
)

// ── Walkable tiles ──

var walkableTiles = map[TileKind]bool{
	TileFloor: true, TileDoorOpen: true, TileTreasure: true, TilePotion: true,
	TileExit: true, TileShallowWater: true, TileLava: true,
	TileTrapHidden: true, TileTrapVisible: true, TileTrapTriggered: true,
	TileChestOpen: true, TileShrine: true, TileMerchant: true,
}

func canWalk(tile TileKind) bool {
	return walkableTiles[tile]
}

// ── Event constructor ──

func evt(turn int, etype EventType, summary string) EventRecord {
	return EventRecord{ID: NewID(), Turn: turn, Type: etype, Summary: summary}
}

func botTag(name string) string {
	return "[BOT] " + name
}

func monTag(monster *Monster) string {
	if monster == nil {
		return "[MONSTER] unknown"
	}
	slug := monster.Slug
	if strings.TrimSpace(slug) == "" {
		slug = MakeMonsterSlug(monster.Kind, monster.Name, monster.ID)
	}
	return fmt.Sprintf("[MONSTER] %s (%s)", monster.Name, slug)
}

// ── Effective stats with fatigue + morale ──

func effectiveAtk(base, fatigue, morale int, effects []StatusEffect) int {
	v := base
	if fatigue >= 100 {
		v -= CFG.FatiguePenalty100
	} else if fatigue >= 75 {
		v -= CFG.FatiguePenalty75
	} else if fatigue >= 50 {
		v -= CFG.FatiguePenalty50
	}
	if morale > CFG.MoraleHigh {
		v += CFG.MoraleHighAtk
	} else if morale < CFG.MoraleLow {
		v += CFG.MoraleLowAtk
	}
	if v < 1 {
		return 1
	}
	return v
}

func effectiveDef(base, fatigue, morale int, effects []StatusEffect) int {
	v := base
	if fatigue >= 100 {
		v -= CFG.FatiguePenalty100
	} else if fatigue >= 75 {
		v -= CFG.FatiguePenalty75
	} else if fatigue >= 50 {
		v -= CFG.FatiguePenalty50
	}
	if morale < CFG.MoraleLow {
		v += CFG.MoraleLowDef
	}
	for _, e := range effects {
		if e.Kind == EffShield {
			v += e.Magnitude
		}
	}
	if v < 0 {
		return 0
	}
	return v
}

// ── Status effects processing ──

func processEffects(hp *int, effects *[]StatusEffect, name string, turn int, events *[]EventRecord) {
	newEffects := make([]StatusEffect, 0, len(*effects))
	for i := range *effects {
		eff := &(*effects)[i]
		switch eff.Kind {
		case EffPoison:
			*hp -= eff.Magnitude
			*events = append(*events, evt(turn, EventEffect, fmt.Sprintf("%s takes %d poison damage.", name, eff.Magnitude)))
		case EffRegen:
			*hp += eff.Magnitude
			*events = append(*events, evt(turn, EventEffect, fmt.Sprintf("%s regenerates %d HP.", name, eff.Magnitude)))
		}
		eff.TurnsRemaining--
		if eff.TurnsRemaining > 0 {
			newEffects = append(newEffects, *eff)
		}
	}
	*effects = newEffects
}

// ── Chest loot generation ──

func generateChestLoot(rng *Rng, rare bool) []Item {
	var pool []ItemKind
	if rare {
		pool = []ItemKind{ItemHealthPotion, ItemKey, ItemScrollReveal, ItemSword, ItemChainArmor, ItemAmuletProtection}
	} else {
		pool = []ItemKind{ItemHealthPotion, ItemKey, ItemAntidote}
	}
	maxC := 1
	if rare {
		maxC = 2
	}
	count := rng.Int(1, maxC)
	var items []Item
	for i := 0; i < count; i++ {
		kind := rng.PickItemKind(pool)
		items = append(items, MakeItem(kind))
	}
	return items
}

// ── Equipment helpers ──

func equipItem(hero *HeroProfile, item Item) {
	slot := item.Slot
	var old *Item
	switch slot {
	case SlotWeapon:
		old = hero.Equipment.Weapon
		hero.Equipment.Weapon = &item
	case SlotArmor:
		old = hero.Equipment.Armor
		hero.Equipment.Armor = &item
	case SlotAccessory:
		old = hero.Equipment.Accessory
		hero.Equipment.Accessory = &item
	}
	if old != nil {
		hero.Inventory = append(hero.Inventory, *old)
		removeStatBonus(&hero.Stats, old)
	}
	applyStatBonus(&hero.Stats, &item)
}

func applyStatBonus(stats *HeroStats, item *Item) {
	if item.StatBonus == nil {
		return
	}
	b := item.StatBonus
	stats.MaxHp += b.MaxHp
	stats.Attack += b.Attack
	stats.Defense += b.Defense
	stats.Speed += b.Speed
	stats.Perception += b.Perception
	if b.MaxHp != 0 && stats.Hp > stats.MaxHp {
		stats.Hp = stats.MaxHp
	}
}

func removeStatBonus(stats *HeroStats, item *Item) {
	if item.StatBonus == nil {
		return
	}
	b := item.StatBonus
	stats.MaxHp -= b.MaxHp
	stats.Attack -= b.Attack
	stats.Defense -= b.Defense
	stats.Speed -= b.Speed
	stats.Perception -= b.Perception
	if b.MaxHp != 0 && stats.Hp > stats.MaxHp {
		stats.Hp = stats.MaxHp
	}
}

// ── Monster movement helpers ──

var monsterWalkable = map[TileKind]bool{
	TileFloor: true, TileDoorOpen: true, TileTrapHidden: true,
	TileTrapTriggered: true, TileShallowWater: true,
}

func canMonsterWalk(pos Position, state *BoardState) bool {
	if pos.Y < 0 || pos.Y >= state.Map.Height || pos.X < 0 || pos.X >= state.Map.Width {
		return false
	}
	tile := state.Map.Tiles[pos.Y][pos.X]
	if !monsterWalkable[tile] {
		return false
	}
	for i := range state.Heroes {
		h := &state.Heroes[i]
		if h.Status == StatusAlive && h.Position.X == pos.X && h.Position.Y == pos.Y {
			return false
		}
	}
	for i := range state.Monsters {
		m := &state.Monsters[i]
		if m.Hp > 0 && m.Position.X == pos.X && m.Position.Y == pos.Y {
			return false
		}
	}
	return true
}

func moveToward(monster *Monster, target Position, state *BoardState) bool {
	dx := target.X - monster.Position.X
	dy := target.Y - monster.Position.Y
	var candidates []Position
	if int(math.Abs(float64(dx))) >= int(math.Abs(float64(dy))) {
		candidates = []Position{
			{monster.Position.X + sign(dx), monster.Position.Y},
			{monster.Position.X, monster.Position.Y + sign(nonZero(dy, 1))},
		}
	} else {
		candidates = []Position{
			{monster.Position.X, monster.Position.Y + sign(dy)},
			{monster.Position.X + sign(nonZero(dx, 1)), monster.Position.Y},
		}
	}
	for _, c := range candidates {
		if canMonsterWalk(c, state) {
			monster.Position = c
			return true
		}
	}
	return false
}

func moveAway(monster *Monster, target Position, state *BoardState) bool {
	dx := monster.Position.X - target.X
	dy := monster.Position.Y - target.Y
	candidates := []Position{
		{monster.Position.X + sign(nonZero(dx, 1)), monster.Position.Y},
		{monster.Position.X, monster.Position.Y + sign(nonZero(dy, 1))},
		{monster.Position.X - sign(nonZero(dx, 1)), monster.Position.Y},
		{monster.Position.X, monster.Position.Y - sign(nonZero(dy, 1))},
	}
	for _, c := range candidates {
		if canMonsterWalk(c, state) {
			monster.Position = c
			return true
		}
	}
	return false
}

func randomStep(monster *Monster, state *BoardState, rng *Rng) bool {
	dirs := rng.ShuffleDirections(AllDirections)
	for _, d := range dirs {
		c := MoveInDir(monster.Position, d)
		if canMonsterWalk(c, state) {
			monster.Position = c
			return true
		}
	}
	return false
}

func sign(v int) int {
	if v > 0 {
		return 1
	}
	if v < 0 {
		return -1
	}
	return 0
}

func nonZero(v, fallback int) int {
	if v == 0 {
		return fallback
	}
	return v
}

// ── Monster attack hero ──

func attackHero(monster *Monster, hero *HeroProfile, turn int, events *[]EventRecord, rng *Rng) {
	def := effectiveDef(hero.Stats.Defense, hero.Fatigue, hero.Morale, hero.Effects)
	dmg := monster.Attack - def + rng.Int(0, 1)
	if dmg < 1 {
		dmg = 1
	}
	hero.Stats.Hp -= dmg
	hero.Morale = Clamp(hero.Morale+CFG.MoraleDamage, CFG.MoraleMin, CFG.MoraleMax)
	remainingHP := hero.Stats.Hp
	if remainingHP < 0 {
		remainingHP = 0
	}
	*events = append(*events, evt(turn, EventCombat, fmt.Sprintf("%s hit %s for %d dmg (HP %d/%d).", monTag(monster), botTag(hero.Name), dmg, remainingHP, hero.Stats.MaxHp)))

	// Spider poison
	if monster.Kind == MonSpider && rng.Chance(0.4) {
		hero.Effects = append(hero.Effects, StatusEffect{Kind: EffPoison, TurnsRemaining: 3, Magnitude: 3})
		hero.Morale = Clamp(hero.Morale+CFG.MoralePoison, CFG.MoraleMin, CFG.MoraleMax)
		*events = append(*events, evt(turn, EventEffect, fmt.Sprintf("%s was poisoned by %s.", botTag(hero.Name), monTag(monster))))
	}

	// Wraith blind
	if monster.Kind == MonWraith && rng.Chance(0.3) {
		hero.Effects = append(hero.Effects, StatusEffect{Kind: EffBlind, TurnsRemaining: 2, Magnitude: 0})
		*events = append(*events, evt(turn, EventEffect, fmt.Sprintf("%s was blinded by %s.", botTag(hero.Name), monTag(monster))))
	}

	if hero.Stats.Hp <= 0 {
		hero.Status = StatusDead
		hero.Stats.Hp = 0
		*events = append(*events, evt(turn, EventDeath, fmt.Sprintf("%s was slain by %s.", botTag(hero.Name), monTag(monster))))
	}
}

// ── Main turn resolution ──

func ResolveTurn(state *BoardState) *BoardState {
	rng := NewRng(fmt.Sprintf("%s:%d", state.Seed, state.Turn))

	// Deep copy
	next := deepCopyBoard(state)
	next.Turn = state.Turn + 1
	next.PendingActions = make(map[EntityID]HeroAction)

	var events []EventRecord

	/* 1. Process status effects */
	for i := range next.Heroes {
		hero := &next.Heroes[i]
		if hero.Status != StatusAlive {
			continue
		}
		processEffects(&hero.Stats.Hp, &hero.Effects, botTag(hero.Name), next.Turn, &events)
		if hero.Stats.Hp <= 0 {
			hero.Status = StatusDead
			hero.Stats.Hp = 0
			events = append(events, evt(next.Turn, EventDeath, fmt.Sprintf("%s succumbed to effects.", botTag(hero.Name))))
		}
	}
	for i := range next.Monsters {
		m := &next.Monsters[i]
		if m.Hp <= 0 {
			continue
		}
		processEffects(&m.Hp, &m.Effects, monTag(m), next.Turn, &events)
	}

	/* 2. Resolve hero actions (sorted by speed, highest first) */
	type heroIdx struct {
		idx   int
		speed int
	}
	var aliveIdxs []heroIdx
	for i := range next.Heroes {
		if next.Heroes[i].Status == StatusAlive {
			aliveIdxs = append(aliveIdxs, heroIdx{i, next.Heroes[i].Stats.Speed})
		}
	}
	sort.Slice(aliveIdxs, func(a, b int) bool {
		return aliveIdxs[a].speed > aliveIdxs[b].speed
	})

	for _, hi := range aliveIdxs {
		hero := &next.Heroes[hi.idx]

		stunned := false
		for _, e := range hero.Effects {
			if e.Kind == EffStun {
				stunned = true
				break
			}
		}
		if stunned {
			hero.LastAction = "stunned"
			events = append(events, evt(next.Turn, EventEffect, fmt.Sprintf("%s is stunned!", hero.Name)))
			continue
		}

		action, ok := state.PendingActions[hero.ID]
		if !ok {
			hero.LastAction = "idle"
			continue
		}

		didCombat := false

		switch action.Kind {
		case ActionMove:
			if action.Direction == "" {
				break
			}
			from := hero.Position
			target := MoveInDir(hero.Position, action.Direction)
			if target.Y < 0 || target.Y >= next.Map.Height || target.X < 0 || target.X >= next.Map.Width {
				hero.LastAction = fmt.Sprintf("blocked %s", action.Direction)
				break
			}
			tile := next.Map.Tiles[target.Y][target.X]

			// Locked door
			if tile == TileDoorLocked {
				keyIdx := -1
				for j, it := range hero.Inventory {
					if it.Kind == ItemKey {
						keyIdx = j
						break
					}
				}
				if keyIdx == -1 {
					hero.LastAction = "door locked (no key)"
					break
				}
				hero.Inventory = append(hero.Inventory[:keyIdx], hero.Inventory[keyIdx+1:]...)
				next.Map.Tiles[target.Y][target.X] = TileDoorOpen
				events = append(events, evt(next.Turn, EventInteraction, fmt.Sprintf("%s unlocked a door.", hero.Name)))
				tile = TileDoorOpen
			}

			// Closed door
			if tile == TileDoorClosed {
				next.Map.Tiles[target.Y][target.X] = TileDoorOpen
				events = append(events, evt(next.Turn, EventInteraction, fmt.Sprintf("%s opened a door.", hero.Name)))
				tile = TileDoorOpen
			}

			// Chest
			if tile == TileChest {
				next.Map.Tiles[target.Y][target.X] = TileChestOpen
				loot := generateChestLoot(rng, false)
				for _, item := range loot {
					if len(hero.Inventory) < CFG.InventoryLimit {
						hero.Inventory = append(hero.Inventory, item)
						events = append(events, evt(next.Turn, EventLoot, fmt.Sprintf("%s found %s in a chest!", hero.Name, item.Name)))
					}
				}
				tile = TileChestOpen
			}

			// Locked chest
			if tile == TileChestLocked {
				keyIdx := -1
				for j, it := range hero.Inventory {
					if it.Kind == ItemKey {
						keyIdx = j
						break
					}
				}
				if keyIdx == -1 {
					hero.LastAction = "chest locked (no key)"
					break
				}
				hero.Inventory = append(hero.Inventory[:keyIdx], hero.Inventory[keyIdx+1:]...)
				next.Map.Tiles[target.Y][target.X] = TileChestOpen
				loot := generateChestLoot(rng, true)
				for _, item := range loot {
					if len(hero.Inventory) < CFG.InventoryLimit {
						hero.Inventory = append(hero.Inventory, item)
						events = append(events, evt(next.Turn, EventLoot, fmt.Sprintf("%s found %s in a locked chest!", hero.Name, item.Name)))
					}
				}
				tile = TileChestOpen
			}

			resolvedTile := next.Map.Tiles[target.Y][target.X]
			if resolvedTile == TileWall || resolvedTile == TileDoorLocked || resolvedTile == TileChestLocked {
				hero.LastAction = fmt.Sprintf("blocked %s", action.Direction)
				break
			}

			// Monster collision
			blockedByMonster := false
			for _, m := range next.Monsters {
				if m.Hp > 0 && m.Position.X == target.X && m.Position.Y == target.Y {
					blockedByMonster = true
					break
				}
			}
			if blockedByMonster {
				hero.LastAction = fmt.Sprintf("blocked by monster %s", action.Direction)
				break
			}

			// Move
			hero.Position = target
			hero.LastAction = fmt.Sprintf("moved %s (%d,%d)->(%d,%d)", action.Direction, from.X, from.Y, target.X, target.Y)
			events = append(events, evt(next.Turn, EventMovement, fmt.Sprintf("%s moved %s from (%d,%d) to (%d,%d).", botTag(hero.Name), action.Direction, from.X, from.Y, target.X, target.Y)))

			// Tile effects
			landedTile := next.Map.Tiles[target.Y][target.X]
			switch landedTile {
			case TileTreasure:
				hero.Score += CFG.TreasureScore
				hero.Morale = Clamp(hero.Morale+CFG.MoraleTreasure, CFG.MoraleMin, CFG.MoraleMax)
				next.Map.Tiles[target.Y][target.X] = TileFloor
				events = append(events, evt(next.Turn, EventLoot, fmt.Sprintf("%s found treasure! +%d", hero.Name, CFG.TreasureScore)))
			case TilePotion:
				if len(hero.Inventory) < CFG.InventoryLimit {
					hero.Inventory = append(hero.Inventory, MakeItem(ItemHealthPotion))
					events = append(events, evt(next.Turn, EventLoot, fmt.Sprintf("%s picked up a health potion.", hero.Name)))
				}
				next.Map.Tiles[target.Y][target.X] = TileFloor
			case TileExit:
				hero.Status = StatusEscaped
				hero.Score += CFG.EscapeBonus
				events = append(events, evt(next.Turn, EventMovement, fmt.Sprintf("%s escaped the dungeon! +%d", hero.Name, CFG.EscapeBonus)))
			case TileTrapHidden:
				hero.Stats.Hp -= CFG.TrapDamage
				next.Map.Tiles[target.Y][target.X] = TileTrapTriggered
				events = append(events, evt(next.Turn, EventTrap, fmt.Sprintf("%s triggered a hidden trap! -%d HP", hero.Name, CFG.TrapDamage)))
				if hero.Stats.Hp <= 0 {
					hero.Status = StatusDead
					hero.Stats.Hp = 0
					events = append(events, evt(next.Turn, EventDeath, fmt.Sprintf("%s was killed by a trap!", hero.Name)))
				}
			case TileTrapVisible:
				hero.Stats.Hp -= CFG.TrapVisibleDamage
				next.Map.Tiles[target.Y][target.X] = TileTrapTriggered
				events = append(events, evt(next.Turn, EventTrap, fmt.Sprintf("%s walked through a visible trap! -%d HP", hero.Name, CFG.TrapVisibleDamage)))
				if hero.Stats.Hp <= 0 {
					hero.Status = StatusDead
					hero.Stats.Hp = 0
					events = append(events, evt(next.Turn, EventDeath, fmt.Sprintf("%s was killed by a trap!", hero.Name)))
				}
			case TileLava:
				hero.Stats.Hp -= CFG.LavaDamage
				events = append(events, evt(next.Turn, EventTrap, fmt.Sprintf("%s is standing in lava! -%d HP", hero.Name, CFG.LavaDamage)))
				if hero.Stats.Hp <= 0 {
					hero.Status = StatusDead
					hero.Stats.Hp = 0
					events = append(events, evt(next.Turn, EventDeath, fmt.Sprintf("%s was consumed by lava!", hero.Name)))
				}
			case TileShallowWater:
				hero.Fatigue = Clamp(hero.Fatigue+CFG.FatigueWaterExtra, 0, CFG.FatigueMax)
			}

			// Pick up floor items
			remaining := make([]FloorItem, 0, len(next.FloorItems))
			for _, fi := range next.FloorItems {
				if fi.Position.X == target.X && fi.Position.Y == target.Y {
					autoEquip := fi.Item.Slot != "" && getEquipmentSlot(hero, fi.Item.Slot) == nil
					if autoEquip {
						equipItem(hero, fi.Item)
						events = append(events, evt(next.Turn, EventLoot, fmt.Sprintf("%s picked up and equipped %s.", hero.Name, fi.Item.Name)))
					} else if len(hero.Inventory) < CFG.InventoryLimit {
						hero.Inventory = append(hero.Inventory, fi.Item)
						events = append(events, evt(next.Turn, EventLoot, fmt.Sprintf("%s picked up %s.", hero.Name, fi.Item.Name)))
					}
				} else {
					remaining = append(remaining, fi)
				}
			}
			next.FloorItems = remaining
			hero.TilesExplored++

		case ActionAttack:
			var monster *Monster
			for i := range next.Monsters {
				if next.Monsters[i].ID == action.TargetID && next.Monsters[i].Hp > 0 {
					monster = &next.Monsters[i]
					break
				}
			}
			if monster == nil || Manhattan(hero.Position, monster.Position) > 1 {
				hero.LastAction = "attack missed (no target)"
				events = append(events, evt(next.Turn, EventCombat, fmt.Sprintf("%s attack missed.", botTag(hero.Name))))
				break
			}

			atk := effectiveAtk(hero.Stats.Attack, hero.Fatigue, hero.Morale, hero.Effects)
			def := effectiveDef(monster.Defense, 0, 50, monster.Effects)
			dmg := atk - def + rng.Int(0, 2)
			if dmg < 1 {
				dmg = 1
			}
			monster.Hp -= dmg
			remainingHP := monster.Hp
			if remainingHP < 0 {
				remainingHP = 0
			}
			hero.LastAction = fmt.Sprintf("hit %s for %d", monster.Name, dmg)
			didCombat = true
			events = append(events, evt(next.Turn, EventCombat, fmt.Sprintf("%s hit %s for %d dmg (HP %d/%d).", botTag(hero.Name), monTag(monster), dmg, remainingHP, monster.MaxHp)))

			if monster.Hp <= 0 {
				hero.Score += monster.XpReward
				hero.Gold += monster.GoldDrop
				hero.Kills++
				hero.Morale = Clamp(hero.Morale+CFG.MoraleKill, CFG.MoraleMin, CFG.MoraleMax)
				events = append(events, evt(next.Turn, EventDeath, fmt.Sprintf("%s slew %s. +%d XP, +%d gold", botTag(hero.Name), monTag(monster), monster.XpReward, monster.GoldDrop)))

				// Drop items
				for _, dropKind := range monster.Drops {
					if rng.Chance(0.5) {
						tmpl := ItemTemplates[dropKind]
						it := MakeItem(dropKind)
						next.FloorItems = append(next.FloorItems, FloorItem{
							ID:       NewID(),
							Item:     it,
							Position: monster.Position,
						})
						events = append(events, evt(next.Turn, EventLoot, fmt.Sprintf("%s dropped %s.", monTag(monster), tmpl.Name)))
					}
				}

				// Quest progress
				for qi := range next.Quests {
					q := &next.Quests[qi]
					if q.HeroID == hero.ID && !q.Completed && q.Objective.Type == "kill" {
						if q.Objective.MonsterKind == monster.Kind {
							q.Objective.Progress++
							if q.Objective.Progress >= q.Objective.Count {
								q.Completed = true
								hero.Score += q.Reward.Score
								hero.Gold += q.Reward.Gold
								events = append(events, evt(next.Turn, EventQuest, fmt.Sprintf("%s completed quest: %s! +%d pts", hero.Name, q.Description, q.Reward.Score)))
							}
						}
					}
				}
			}

		case ActionRest:
			heal := CFG.RestHeal
			if hero.Stats.MaxHp-hero.Stats.Hp < heal {
				heal = hero.Stats.MaxHp - hero.Stats.Hp
			}
			hero.Stats.Hp += heal
			hero.Fatigue = Clamp(hero.Fatigue-CFG.FatigueRestReduction, 0, CFG.FatigueMax)
			hero.LastAction = fmt.Sprintf("rested +%d HP", heal)

		case ActionUseItem:
			itemIdx := -1
			for j, it := range hero.Inventory {
				if it.ID == action.ItemID {
					itemIdx = j
					break
				}
			}
			if itemIdx == -1 {
				hero.LastAction = "no such item"
				break
			}
			item := hero.Inventory[itemIdx]

			if item.Consumable {
				hero.Inventory = append(hero.Inventory[:itemIdx], hero.Inventory[itemIdx+1:]...)
				switch item.Kind {
				case ItemHealthPotion:
					heal := CFG.PotionHeal
					if hero.Stats.MaxHp-hero.Stats.Hp < heal {
						heal = hero.Stats.MaxHp - hero.Stats.Hp
					}
					hero.Stats.Hp += heal
					hero.LastAction = fmt.Sprintf("potion +%d HP", heal)
					events = append(events, evt(next.Turn, EventLoot, fmt.Sprintf("%s used a potion, healed %d HP.", hero.Name, heal)))
				case ItemAntidote:
					newEff := make([]StatusEffect, 0)
					for _, e := range hero.Effects {
						if e.Kind != EffPoison {
							newEff = append(newEff, e)
						}
					}
					hero.Effects = newEff
					hero.LastAction = "antidote - cured poison"
					events = append(events, evt(next.Turn, EventEffect, fmt.Sprintf("%s cured poison.", hero.Name)))
				case ItemKey:
					hero.LastAction = "used key (nothing to unlock here)"
				case ItemScrollReveal:
					R := CFG.ScrollRevealRadius
					revealed := 0
					for dy := -R; dy <= R; dy++ {
						for dx := -R; dx <= R; dx++ {
							ty := hero.Position.Y + dy
							tx := hero.Position.X + dx
							if ty >= 0 && ty < next.Map.Height && tx >= 0 && tx < next.Map.Width {
								if next.Map.Tiles[ty][tx] == TileTrapHidden {
									next.Map.Tiles[ty][tx] = TileTrapVisible
									revealed++
								}
							}
						}
					}
					hero.LastAction = fmt.Sprintf("scroll of reveal (%d traps found)", revealed)
					events = append(events, evt(next.Turn, EventInteraction, fmt.Sprintf("%s used Scroll of Reveal — %d traps revealed!", hero.Name, revealed)))
				case ItemScrollTeleport:
					for a := 0; a < 200; a++ {
						tx := rng.Int(1, next.Map.Width-2)
						ty := rng.Int(1, next.Map.Height-2)
						if next.Map.Tiles[ty][tx] == TileFloor {
							occupied := false
							for _, m := range next.Monsters {
								if m.Hp > 0 && m.Position.X == tx && m.Position.Y == ty {
									occupied = true
									break
								}
							}
							if !occupied {
								hero.Position = Position{tx, ty}
								hero.LastAction = "teleported!"
								events = append(events, evt(next.Turn, EventMovement, fmt.Sprintf("%s teleported away!", hero.Name)))
								break
							}
						}
					}
				}
			} else if item.Slot != "" {
				hero.Inventory = append(hero.Inventory[:itemIdx], hero.Inventory[itemIdx+1:]...)
				equipItem(hero, item)
				hero.LastAction = fmt.Sprintf("equipped %s", item.Name)
				events = append(events, evt(next.Turn, EventLoot, fmt.Sprintf("%s equipped %s.", hero.Name, item.Name)))
			}

		case ActionInteract:
			var npc *Npc
			for ni := range next.Npcs {
				if next.Npcs[ni].ID == action.TargetID {
					npc = &next.Npcs[ni]
					break
				}
			}
			if npc == nil || Manhattan(hero.Position, npc.Position) > 1 {
				hero.LastAction = "nothing to interact with"
				break
			}
			alreadyInteracted := false
			for _, hid := range npc.InteractedBy {
				if hid == hero.ID {
					alreadyInteracted = true
					break
				}
			}
			if alreadyInteracted {
				hero.LastAction = fmt.Sprintf("already interacted with %s", npc.Name)
				break
			}
			npc.InteractedBy = append(npc.InteractedBy, hero.ID)

			switch npc.Kind {
			case NpcShrine:
				heal := CFG.ShrineHeal
				if hero.Stats.MaxHp-hero.Stats.Hp < heal {
					heal = hero.Stats.MaxHp - hero.Stats.Hp
				}
				hero.Stats.Hp += heal
				hero.Effects = append(hero.Effects, StatusEffect{Kind: EffShield, TurnsRemaining: 3, Magnitude: 3})
				hero.Morale = Clamp(hero.Morale+CFG.MoraleShrine, CFG.MoraleMin, CFG.MoraleMax)
				hero.LastAction = fmt.Sprintf("shrine: +%d HP, +shield", heal)
				events = append(events, evt(next.Turn, EventInteraction, fmt.Sprintf("%s prayed at %s — healed %d HP, gained shield.", hero.Name, npc.Name, heal)))

			case NpcMerchant:
				if len(npc.Inventory) > 0 {
					// Buy the most expensive affordable item
					bestIdx := -1
					bestVal := 0
					for ii, it := range npc.Inventory {
						if it.Value <= hero.Gold && it.Value > bestVal {
							bestIdx = ii
							bestVal = it.Value
						}
					}
					if bestIdx >= 0 && len(hero.Inventory) < CFG.InventoryLimit {
						bought := npc.Inventory[bestIdx]
						hero.Gold -= bought.Value
						hero.Inventory = append(hero.Inventory, bought)
						npc.Inventory = append(npc.Inventory[:bestIdx], npc.Inventory[bestIdx+1:]...)
						hero.LastAction = fmt.Sprintf("bought %s for %dg", bought.Name, bought.Value)
						events = append(events, evt(next.Turn, EventInteraction, fmt.Sprintf("%s bought %s from %s.", hero.Name, bought.Name, npc.Name)))
					} else {
						hero.LastAction = "merchant: nothing affordable"
					}
				}

			case NpcPrisoner:
				hero.LastAction = fmt.Sprintf("freed %s", npc.Name)
				events = append(events, evt(next.Turn, EventInteraction, fmt.Sprintf("%s freed %s!", hero.Name, npc.Name)))

				questCompleted := false
				for qi := range next.Quests {
					q := &next.Quests[qi]
					if q.HeroID == hero.ID && !q.Completed && q.Objective.Type == "rescue" && q.Objective.NpcID == npc.ID {
						q.Objective.Done = true
						q.Completed = true
						hero.Score += q.Reward.Score
						hero.Gold += q.Reward.Gold
						questCompleted = true
						events = append(events, evt(next.Turn, EventQuest, fmt.Sprintf("%s completed rescue quest! +%d pts", hero.Name, q.Reward.Score)))
					}
				}
				if !questCompleted {
					hero.Score += 15
					hero.Gold += 10
					events = append(events, evt(next.Turn, EventQuest, fmt.Sprintf("%s earned a rescue bonus: +15 pts, +10 gold.", hero.Name)))
				}
			}

		case ActionWait:
			hero.Fatigue = Clamp(hero.Fatigue-CFG.FatigueWaitReduction, 0, CFG.FatigueMax)
			hero.LastAction = "waited"
		}

		// Make bot outcomes visible in feed even when no special interaction event fired.
		if hero.Status == StatusAlive && strings.TrimSpace(hero.LastAction) != "" {
			events = append(events, evt(next.Turn, EventSystem, fmt.Sprintf("%s %s.", botTag(hero.Name), hero.LastAction)))
		}

		// Fatigue update
		if hero.Status == StatusAlive {
			extra := 0
			if didCombat {
				extra = CFG.FatigueCombatExtra
			}
			hero.Fatigue = Clamp(hero.Fatigue+CFG.FatiguePerTurn+extra, 0, CFG.FatigueMax)
			hero.TurnsSurvived++
		}
	}

	/* 3. Monster AI */
	for i := range next.Monsters {
		monster := &next.Monsters[i]
		if monster.Hp <= 0 {
			continue
		}

		var nearest *HeroProfile
		bestDist := 9999
		for j := range next.Heroes {
			h := &next.Heroes[j]
			if h.Status != StatusAlive {
				continue
			}
			d := Manhattan(monster.Position, h.Position)
			if d < bestDist {
				bestDist = d
				nearest = h
			}
		}
		if nearest == nil {
			break
		}
		dist := bestDist

		// Flee override when low HP
		if monster.Hp < monster.MaxHp/4 && monster.Behavior != BehaviorGuard {
			if dist <= 1 {
				attackHero(monster, nearest, next.Turn, &events, rng)
			} else {
				if moveAway(monster, nearest.Position, next) {
					events = append(events, evt(next.Turn, EventMovement, fmt.Sprintf("%s retreats.", monTag(monster))))
				}
			}
			continue
		}

		switch monster.Behavior {
		case BehaviorChase:
			if dist <= 1 {
				attackHero(monster, nearest, next.Turn, &events, rng)
			} else if dist <= monster.AlertRange {
				if moveToward(monster, nearest.Position, next) {
					events = append(events, evt(next.Turn, EventMovement, fmt.Sprintf("%s closes in.", monTag(monster))))
				}
			} else if rng.Chance(0.18) {
				if randomStep(monster, next, rng) {
					events = append(events, evt(next.Turn, EventMovement, fmt.Sprintf("%s prowls.", monTag(monster))))
				}
			}
		case BehaviorPatrol:
			if dist <= 1 {
				attackHero(monster, nearest, next.Turn, &events, rng)
			} else if dist <= monster.AlertRange {
				if moveToward(monster, nearest.Position, next) {
					events = append(events, evt(next.Turn, EventMovement, fmt.Sprintf("%s advances.", monTag(monster))))
				}
			} else if rng.Chance(0.3) {
				if randomStep(monster, next, rng) {
					events = append(events, evt(next.Turn, EventMovement, fmt.Sprintf("%s patrols.", monTag(monster))))
				}
			}
		case BehaviorAmbush:
			if dist <= 1 {
				attackHero(monster, nearest, next.Turn, &events, rng)
			} else if dist <= 2 {
				if moveToward(monster, nearest.Position, next) {
					events = append(events, evt(next.Turn, EventMovement, fmt.Sprintf("%s lunges from cover.", monTag(monster))))
				}
			} else if rng.Chance(0.12) {
				if randomStep(monster, next, rng) {
					events = append(events, evt(next.Turn, EventMovement, fmt.Sprintf("%s shifts in the shadows.", monTag(monster))))
				}
			}
		case BehaviorGuard:
			if dist <= 1 {
				attackHero(monster, nearest, next.Turn, &events, rng)
			} else if dist <= monster.AlertRange {
				if moveToward(monster, nearest.Position, next) {
					events = append(events, evt(next.Turn, EventMovement, fmt.Sprintf("%s repositions.", monTag(monster))))
				}
			} else if rng.Chance(0.08) {
				if randomStep(monster, next, rng) {
					events = append(events, evt(next.Turn, EventMovement, fmt.Sprintf("%s patrols its post.", monTag(monster))))
				}
			}
		case BehaviorFlee:
			if dist <= 1 {
				attackHero(monster, nearest, next.Turn, &events, rng)
			} else {
				if moveAway(monster, nearest.Position, next) {
					events = append(events, evt(next.Turn, EventMovement, fmt.Sprintf("%s flees.", monTag(monster))))
				}
			}
		}
	}

	/* 5. Remove dead monsters */
	alive := make([]Monster, 0, len(next.Monsters))
	for _, m := range next.Monsters {
		if m.Hp > 0 {
			alive = append(alive, m)
		}
	}
	next.Monsters = alive

	/* 6. Spawn new monsters if running low */
	if len(next.Monsters) < CFG.MonsterSpawnMin && rng.Chance(CFG.MonsterSpawnChance) {
		for attempt := 0; attempt < 80; attempt++ {
			x := rng.Int(1, next.Map.Width-2)
			y := rng.Int(1, next.Map.Height-2)
			if next.Map.Tiles[y][x] != TileFloor {
				continue
			}
			occupied := false
			for _, monster := range next.Monsters {
				if monster.Hp > 0 && monster.Position.X == x && monster.Position.Y == y {
					occupied = true
					break
				}
			}
			if occupied {
				continue
			}
			farEnough := true
			for _, h := range next.Heroes {
				if h.Status == StatusAlive && Manhattan(h.Position, Position{x, y}) <= 8 {
					farEnough = false
					break
				}
			}
			if !farEnough {
				continue
			}

			kinds := []MonsterKind{MonGoblin, MonGoblin, MonSpider, MonSkeleton}
			kind := rng.PickMonsterKind(kinds)
			tmpl := MonsterTemplates[kind]
			drops := make([]ItemKind, len(tmpl.Drops))
			copy(drops, tmpl.Drops)
			monsterID := NewID()
			monsterName := rng.Pick(MonsterNames[kind])
			next.Monsters = append(next.Monsters, Monster{
				ID:         monsterID,
				Slug:       MakeMonsterSlug(kind, monsterName, monsterID),
				Kind:       kind,
				Name:       monsterName,
				Hp:         tmpl.Hp,
				MaxHp:      tmpl.Hp,
				Attack:     tmpl.Attack,
				Defense:    tmpl.Defense,
				Speed:      tmpl.Speed,
				XpReward:   tmpl.XpReward,
				GoldDrop:   tmpl.GoldDrop,
				Behavior:   tmpl.Behavior,
				Position:   Position{x, y},
				Effects:    []StatusEffect{},
				Drops:      drops,
				AlertRange: tmpl.AlertRange,
			})
			events = append(events, evt(next.Turn, EventSpawn, fmt.Sprintf("A %s lurks in the shadows!", kind)))
			break
		}
	}

	/* 7. Notify ally deaths for morale */
	hasSlainDeath := false
	for _, e := range events {
		if e.Type == EventDeath && len(e.Summary) > 9 && contains(e.Summary, "was slain") {
			hasSlainDeath = true
			break
		}
	}
	if hasSlainDeath {
		for i := range next.Heroes {
			if next.Heroes[i].Status == StatusAlive {
				next.Heroes[i].Morale = Clamp(next.Heroes[i].Morale+CFG.MoraleAllyDeath, CFG.MoraleMin, CFG.MoraleMax)
			}
		}
	}

	next.Events = append(next.Events, events...)
	if len(next.Events) > CFG.MaxEvents {
		next.Events = next.Events[len(next.Events)-CFG.MaxEvents:]
	}
	return next
}

// ── Helpers ──

func getEquipmentSlot(hero *HeroProfile, slot ItemSlot) *Item {
	switch slot {
	case SlotWeapon:
		return hero.Equipment.Weapon
	case SlotArmor:
		return hero.Equipment.Armor
	case SlotAccessory:
		return hero.Equipment.Accessory
	}
	return nil
}

func contains(s, sub string) bool {
	return len(s) >= len(sub) && (s == sub || len(s) > 0 && containsSubstr(s, sub))
}

func containsSubstr(s, sub string) bool {
	for i := 0; i <= len(s)-len(sub); i++ {
		if s[i:i+len(sub)] == sub {
			return true
		}
	}
	return false
}

// ── Deep copy ──

func deepCopyBoard(state *BoardState) *BoardState {
	next := &BoardState{
		Seed:        state.Seed,
		DungeonName: state.DungeonName,
		Turn:        state.Turn,
	}

	// Copy map
	tiles := make([][]TileKind, len(state.Map.Tiles))
	for y := range state.Map.Tiles {
		tiles[y] = make([]TileKind, len(state.Map.Tiles[y]))
		copy(tiles[y], state.Map.Tiles[y])
	}
	next.Map = GameMap{Width: state.Map.Width, Height: state.Map.Height, Tiles: tiles}

	// Monsters
	next.Monsters = make([]Monster, len(state.Monsters))
	for i, m := range state.Monsters {
		mc := m
		mc.Position = m.Position
		mc.Effects = make([]StatusEffect, len(m.Effects))
		copy(mc.Effects, m.Effects)
		mc.Drops = make([]ItemKind, len(m.Drops))
		copy(mc.Drops, m.Drops)
		next.Monsters[i] = mc
	}

	// Heroes
	next.Heroes = make([]HeroProfile, len(state.Heroes))
	for i, h := range state.Heroes {
		hc := h
		hc.Stats = h.Stats
		hc.BaseStats = h.BaseStats
		hc.Position = h.Position
		hc.Inventory = make([]Item, len(h.Inventory))
		copy(hc.Inventory, h.Inventory)
		hc.Equipment = HeroEquipment{
			Weapon:    copyItemPtr(h.Equipment.Weapon),
			Armor:     copyItemPtr(h.Equipment.Armor),
			Accessory: copyItemPtr(h.Equipment.Accessory),
		}
		hc.Effects = make([]StatusEffect, len(h.Effects))
		copy(hc.Effects, h.Effects)
		next.Heroes[i] = hc
	}

	// NPCs
	next.Npcs = make([]Npc, len(state.Npcs))
	for i, n := range state.Npcs {
		nc := n
		nc.InteractedBy = make([]EntityID, len(n.InteractedBy))
		copy(nc.InteractedBy, n.InteractedBy)
		if n.Inventory != nil {
			nc.Inventory = make([]Item, len(n.Inventory))
			copy(nc.Inventory, n.Inventory)
		}
		next.Npcs[i] = nc
	}

	// Floor items
	next.FloorItems = make([]FloorItem, len(state.FloorItems))
	copy(next.FloorItems, state.FloorItems)

	// Quests
	next.Quests = make([]Quest, len(state.Quests))
	for i, q := range state.Quests {
		qc := q
		qc.Objective = q.Objective
		next.Quests[i] = qc
	}

	// Events
	next.Events = make([]EventRecord, len(state.Events))
	copy(next.Events, state.Events)

	return next
}

func copyItemPtr(p *Item) *Item {
	if p == nil {
		return nil
	}
	c := *p
	return &c
}
