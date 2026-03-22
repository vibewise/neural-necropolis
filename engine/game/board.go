package game

import (
	"errors"
	"fmt"
	"strings"
	"sync"
	"time"
)

// ErrHeroCapacityReached is returned when a board is full.
var ErrHeroCapacityReached = errors.New("hero_capacity_reached")

// Board wraps a single board's state and provides thread-safe operations.
type Board struct {
	mu               sync.RWMutex
	ID               string
	state            *BoardState
	rng              *Rng
	botMessages      []BotMessage
	lifecycle        BoardLifecycle
	maxHeroes        int
	completionReason string
	autoStartAfter   time.Time
}

func NewBoard(id, seed string, maxHeroes int) *Board {
	return &Board{
		ID:               id,
		state:            GenerateDungeon(seed),
		rng:              NewRng(seed + ":board"),
		botMessages:      []BotMessage{},
		lifecycle:        LifecycleOpen,
		maxHeroes:        maxHeroes,
		completionReason: "",
	}
}

// Turn returns the current turn number (safe read-only accessor).
func (b *Board) Turn() int {
	b.mu.RLock()
	defer b.mu.RUnlock()
	return b.state.Turn
}

// Seed returns the board seed (safe read-only accessor).
func (b *Board) Seed() string {
	b.mu.RLock()
	defer b.mu.RUnlock()
	return b.state.Seed
}

// HeroCount returns the number of heroes on this board (safe read-only accessor).
func (b *Board) HeroCount() int {
	b.mu.RLock()
	defer b.mu.RUnlock()
	return len(b.state.Heroes)
}

func (b *Board) Lifecycle() BoardLifecycle {
	b.mu.RLock()
	defer b.mu.RUnlock()
	return b.lifecycle
}

func (b *Board) SetLifecycle(lc BoardLifecycle) {
	b.mu.Lock()
	defer b.mu.Unlock()
	b.lifecycle = lc
}

func (b *Board) SetCompletionReason(reason string) {
	b.mu.Lock()
	defer b.mu.Unlock()
	b.completionReason = reason
}

func (b *Board) CompletionReason() string {
	b.mu.RLock()
	defer b.mu.RUnlock()
	return b.completionReason
}

func (b *Board) SetAutoStartAfter(t time.Time) {
	b.mu.Lock()
	defer b.mu.Unlock()
	b.autoStartAfter = t
}

func (b *Board) AutoStartAfter() time.Time {
	b.mu.RLock()
	defer b.mu.RUnlock()
	return b.autoStartAfter
}

func (b *Board) AutoStartReady(now time.Time) bool {
	b.mu.RLock()
	defer b.mu.RUnlock()
	return b.autoStartReadyLocked(now)
}

func (b *Board) autoStartReadyLocked(now time.Time) bool {
	return b.autoStartAfter.IsZero() || !now.Before(b.autoStartAfter)
}

func (b *Board) canAutoStartLocked(now time.Time) bool {
	if b.lifecycle != LifecycleOpen {
		return false
	}
	heroCount := len(b.state.Heroes)
	if heroCount >= CFG.MinBotsToStart {
		return true
	}
	if heroCount < CFG.MinBotsAfterWait {
		return false
	}
	return b.autoStartReadyLocked(now)
}

func (b *Board) RecalculateAutoStartAfter(now time.Time) (time.Time, bool, bool) {
	b.mu.Lock()
	defer b.mu.Unlock()

	return b.recalculateAutoStartAfterLocked(now)
}

func (b *Board) recalculateAutoStartAfterLocked(now time.Time) (time.Time, bool, bool) {
	previous := b.autoStartAfter
	heroCount := len(b.state.Heroes)
	switch {
	case b.lifecycle != LifecycleOpen:
		b.autoStartAfter = time.Time{}
	case heroCount == 0:
		b.autoStartAfter = time.Time{}
	case heroCount >= CFG.MinBotsToStart:
		b.autoStartAfter = time.Time{}
	case heroCount >= CFG.MinBotsAfterWait:
		if b.autoStartAfter.IsZero() {
			b.autoStartAfter = now.Add(time.Duration(CFG.BoardJoinWindowMs) * time.Millisecond)
		}
	default:
		b.autoStartAfter = time.Time{}
	}
	return b.autoStartAfter, previous.IsZero() && !b.autoStartAfter.IsZero(), !previous.IsZero() && b.autoStartAfter.IsZero()
}

// queueStatusLocked returns the queue status string and join-window remaining.
// Caller must hold b.mu (read or write).
func (b *Board) queueStatusLocked(now time.Time) (string, int64) {
	switch b.lifecycle {
	case LifecycleQueued:
		return "queued for another run", 0
	case LifecycleRunning:
		return "running", 0
	case LifecycleCompleted:
		return "completed", 0
	}

	heroCount := len(b.state.Heroes)
	if heroCount == 0 {
		return "waiting for heroes", 0
	}
	if heroCount >= CFG.MinBotsToStart {
		return "ready to start", 0
	}
	if heroCount >= CFG.MinBotsAfterWait && !b.autoStartAfter.IsZero() && now.Before(b.autoStartAfter) {
		remaining := b.autoStartAfter.Sub(now).Milliseconds()
		if remaining < 0 {
			remaining = 0
		}
		return "waiting for more heroes", remaining
	}
	if heroCount >= CFG.MinBotsAfterWait {
		return "ready to start", 0
	}
	return "ready to start", 0
}

func (b *Board) queueStatus(now time.Time) (string, int64) {
	b.mu.RLock()
	defer b.mu.RUnlock()
	return b.queueStatusLocked(now)
}

func (b *Board) EventCount() int {
	b.mu.RLock()
	defer b.mu.RUnlock()
	return len(b.state.Events)
}

func (b *Board) EventsSince(index int) []EventRecord {
	b.mu.RLock()
	defer b.mu.RUnlock()
	if index < 0 {
		index = 0
	}
	if index > len(b.state.Events) {
		index = len(b.state.Events)
	}
	events := make([]EventRecord, len(b.state.Events[index:]))
	copy(events, b.state.Events[index:])
	return events
}

// Snapshot builds a dashboard-ready snapshot of this board.
func (b *Board) Snapshot(turnState TurnState) BoardSnapshot {
	b.mu.RLock()
	defer b.mu.RUnlock()
	s := b.state

	heroes := make([]HeroProfile, len(s.Heroes))
	copy(heroes, s.Heroes)
	leaderboard := b.buildLeaderboard()
	monsters := make([]Monster, len(s.Monsters))
	copy(monsters, s.Monsters)
	npcs := make([]Npc, len(s.Npcs))
	copy(npcs, s.Npcs)
	floorItems := make([]FloorItem, len(s.FloorItems))
	copy(floorItems, s.FloorItems)
	mapTiles := make([][]TileKind, len(s.Map.Tiles))
	for i, row := range s.Map.Tiles {
		mapTiles[i] = make([]TileKind, len(row))
		copy(mapTiles[i], row)
	}
	botMessages := make([]BotMessage, len(b.botMessages))
	copy(botMessages, b.botMessages)

	recent := s.Events
	// Reverse
	rev := make([]EventRecord, len(recent))
	for i, e := range recent {
		rev[len(recent)-1-i] = e
	}

	return BoardSnapshot{
		Seed:      s.Seed,
		BoardID:   b.ID,
		BoardSlug: MakeBoardSlug(s.DungeonName, b.ID),
		World: struct {
			DungeonName string `json:"dungeonName"`
			Turn        int    `json:"turn"`
			MapWidth    int    `json:"mapWidth"`
			MapHeight   int    `json:"mapHeight"`
		}{
			DungeonName: s.DungeonName,
			Turn:        s.Turn,
			MapWidth:    s.Map.Width,
			MapHeight:   s.Map.Height,
		},
		Heroes:       heroes,
		Leaderboard:  leaderboard,
		Monsters:     monsters,
		Npcs:         npcs,
		FloorItems:   floorItems,
		Map:          mapTiles,
		RecentEvents: rev,
		BotMessages:  botMessages,
		TurnState:    turnState,
		Lobby:        b.lobbyInfoLocked(),
	}
}

// lobbyInfoLocked builds the LobbyInfo for this board.
// Caller must hold b.mu (read or write).
func (b *Board) lobbyInfoLocked() LobbyInfo {
	minStart := CFG.MinBotsToStart
	queueStatus, joinWindowRemainingMs := b.queueStatusLocked(time.Now())
	return LobbyInfo{
		BoardID:               b.ID,
		BoardSlug:             MakeBoardSlug(b.state.DungeonName, b.ID),
		BoardName:             b.state.DungeonName,
		AttachedHeroes:        len(b.state.Heroes),
		MaxHeroes:             b.maxHeroes,
		RequiredHeroes:        &minStart,
		MinHeroesToStart:      minStart,
		CanStart:              b.canAutoStartLocked(time.Now()),
		CanReset:              b.lifecycle != LifecycleRunning,
		QueueStatus:           queueStatus,
		JoinWindowRemainingMs: joinWindowRemainingMs,
		Status:                b.lifecycle,
		Started:               b.lifecycle == LifecycleRunning,
		CompletionReason:      b.completionReason,
	}
}

func (b *Board) buildLeaderboard() []ScoreTrack {
	heroes := make([]HeroProfile, len(b.state.Heroes))
	copy(heroes, b.state.Heroes)

	// Sort by score desc
	for i := 0; i < len(heroes); i++ {
		for j := i + 1; j < len(heroes); j++ {
			if heroes[j].Score > heroes[i].Score {
				heroes[i], heroes[j] = heroes[j], heroes[i]
			}
		}
	}

	tracks := make([]ScoreTrack, len(heroes))
	for i, h := range heroes {
		combatScore := h.Kills * 5
		treasureScore := h.Gold
		explorationScore := h.TilesExplored / CFG.ExploreScoreDivisor
		questScore := 0
		for _, q := range b.state.Quests {
			if q.HeroID == h.ID && q.Completed {
				questScore += q.Reward.Score
			}
		}

		tracks[i] = ScoreTrack{
			HeroID:           h.ID,
			HeroName:         h.Name,
			Trait:            h.Trait,
			TotalScore:       h.Score + explorationScore + h.TurnsSurvived/CFG.SurvivalScoreDivisor,
			CombatScore:      combatScore,
			TreasureScore:    treasureScore,
			ExplorationScore: explorationScore,
			QuestScore:       questScore,
			TurnsSurvived:    h.TurnsSurvived,
			TilesExplored:    h.TilesExplored,
			MonstersKilled:   h.Kills,
			Escaped:          h.Status == StatusEscaped,
			Status:           h.Status,
		}
	}
	return tracks
}

// RegisterHero registers or revives a hero on this board.
func (b *Board) RegisterHero(input HeroRegistration) (*HeroProfile, error) {
	b.mu.Lock()
	defer b.mu.Unlock()

	// Check existing
	for i := range b.state.Heroes {
		h := &b.state.Heroes[i]
		if h.ID == input.ID {
			if h.Status == StatusDead {
				spawn := b.pickRandomSpawnPosition()
				h.Stats = CFG.HeroBaseStats
				h.BaseStats = CFG.HeroBaseStats
				h.Position = spawn
				h.Status = StatusAlive
				h.Inventory = nil
				h.Equipment = HeroEquipment{}
				h.Effects = nil
				h.Fatigue = 0
				h.Morale = CFG.MoraleStart
				h.Gold = h.Gold / 2
				h.LastAction = "respawned"
			} else {
				h.LastAction = "reconnected"
			}
			return h, nil
		}
	}

	if b.maxHeroes > 0 && len(b.state.Heroes) >= b.maxHeroes {
		return nil, ErrHeroCapacityReached
	}

	if input.ID == "" {
		input.ID = NewID()
	}

	trait := input.PreferredTrait
	if trait == "" {
		trait = TraitCurious
	}
	base := CFG.HeroBaseStats
	if bonus, ok := CFG.TraitBonuses[trait]; ok {
		base.MaxHp += bonus.MaxHp
		base.Attack += bonus.Attack
		base.Defense += bonus.Defense
		base.Speed += bonus.Speed
		base.Perception += bonus.Perception
		base.Hp = base.MaxHp
	}

	pos := b.pickRandomSpawnPosition()

	hero := HeroProfile{
		ID:            input.ID,
		Name:          input.Name,
		Strategy:      input.Strategy,
		Trait:         trait,
		Stats:         base,
		BaseStats:     base,
		Position:      pos,
		Score:         0,
		Kills:         0,
		TilesExplored: 0,
		Gold:          0,
		Inventory:     []Item{},
		Equipment:     HeroEquipment{},
		Effects:       []StatusEffect{},
		Fatigue:       0,
		Morale:        CFG.MoraleStart,
		Status:        StatusAlive,
		LastAction:    "entered",
		TurnsSurvived: 0,
	}

	b.state.Heroes = append(b.state.Heroes, hero)

	// Rescue quest if prisoner exists
	for _, npc := range b.state.Npcs {
		if npc.Kind == NpcPrisoner {
			b.state.Quests = append(b.state.Quests, Quest{
				ID:          NewID(),
				HeroID:      hero.ID,
				Description: fmt.Sprintf("Rescue %s", npc.Name),
				Objective:   QuestObjective{Type: "rescue", NpcID: npc.ID},
				Reward:      QuestReward{Score: 25, Gold: 15},
			})
			break
		}
	}

	return &b.state.Heroes[len(b.state.Heroes)-1], nil
}

// RemoveHeroIfOpen removes a hero from an open board before it has started.
func (b *Board) RemoveHeroIfOpen(heroID string, now time.Time) (string, bool) {
	b.mu.Lock()
	defer b.mu.Unlock()

	if b.lifecycle != LifecycleOpen {
		return "", false
	}

	for i := range b.state.Heroes {
		if b.state.Heroes[i].ID != heroID {
			continue
		}
		heroName := b.state.Heroes[i].Name
		b.state.Heroes = append(b.state.Heroes[:i], b.state.Heroes[i+1:]...)
		delete(b.state.PendingActions, EntityID(heroID))

		quests := b.state.Quests[:0]
		for _, quest := range b.state.Quests {
			if quest.HeroID == EntityID(heroID) {
				continue
			}
			quests = append(quests, quest)
		}
		b.state.Quests = quests

		messages := b.botMessages[:0]
		for _, message := range b.botMessages {
			if message.HeroID == EntityID(heroID) {
				continue
			}
			messages = append(messages, message)
		}
		b.botMessages = messages

		b.recalculateAutoStartAfterLocked(now)
		return heroName, true
	}

	return "", false
}

// MarkHeroDisconnected annotates a living hero so spectators can see the session was lost.
func (b *Board) MarkHeroDisconnected(heroID string) (string, bool) {
	b.mu.Lock()
	defer b.mu.Unlock()

	for i := range b.state.Heroes {
		if b.state.Heroes[i].ID != heroID {
			continue
		}
		hero := &b.state.Heroes[i]
		if hero.LastAction == "session expired" {
			return hero.Name, false
		}
		if hero.Status == StatusAlive {
			hero.LastAction = "session expired"
		}
		return hero.Name, true
	}

	return "", false
}

func (b *Board) pickRandomSpawnPosition() Position {
	occupied := make(map[string]bool)
	for _, h := range b.state.Heroes {
		occupied[fmt.Sprintf("%d,%d", h.Position.X, h.Position.Y)] = true
	}
	for _, m := range b.state.Monsters {
		if m.Hp > 0 {
			occupied[fmt.Sprintf("%d,%d", m.Position.X, m.Position.Y)] = true
		}
	}
	for _, n := range b.state.Npcs {
		occupied[fmt.Sprintf("%d,%d", n.Position.X, n.Position.Y)] = true
	}

	var candidates []Position
	for y := 0; y < b.state.Map.Height; y++ {
		for x := 0; x < b.state.Map.Width; x++ {
			key := fmt.Sprintf("%d,%d", x, y)
			if occupied[key] {
				continue
			}
			if b.state.Map.Tiles[y][x] == TileFloor {
				candidates = append(candidates, Position{x, y})
			}
		}
	}

	if len(candidates) == 0 {
		return GetSpawnPosition(b.state)
	}
	idx := b.rng.Int(0, len(candidates)-1)
	return candidates[idx]
}

// GetVision returns the hero's field of view and legal actions.
func (b *Board) GetVision(heroID string) (*VisionData, error) {
	b.mu.RLock()
	defer b.mu.RUnlock()

	var hero *HeroProfile
	var heroCopy HeroProfile
	for i := range b.state.Heroes {
		if b.state.Heroes[i].ID == heroID {
			heroCopy = b.state.Heroes[i]
			hero = &heroCopy
			break
		}
	}
	if hero == nil {
		return nil, fmt.Errorf("unknown hero: %s", heroID)
	}

	R := CFG.VisionBase + hero.Stats.Perception/2
	for _, e := range hero.Effects {
		if e.Kind == EffBlind {
			R = max(1, R/2)
			break
		}
	}

	tiles := make([]VisionTile, 0)
	for y := max(0, hero.Position.Y-R); y <= min(b.state.Map.Height-1, hero.Position.Y+R); y++ {
		for x := max(0, hero.Position.X-R); x <= min(b.state.Map.Width-1, hero.Position.X+R); x++ {
			if abs(x-hero.Position.X)+abs(y-hero.Position.Y) <= R {
				kind := b.state.Map.Tiles[y][x]
				if kind == TileTrapHidden && hero.Stats.Perception < CFG.PerceptionTrapThreshold {
					kind = TileFloor
				}
				tiles = append(tiles, VisionTile{X: x, Y: y, Kind: kind})
			}
		}
	}

	visMonsters := make([]Monster, 0)
	for _, m := range b.state.Monsters {
		if m.Hp > 0 && Manhattan(m.Position, hero.Position) <= R {
			visMonsters = append(visMonsters, m)
		}
	}

	visHeroes := make([]HeroProfile, 0)
	for _, h := range b.state.Heroes {
		if h.ID != heroID && h.Status == StatusAlive && Manhattan(h.Position, hero.Position) <= R {
			visHeroes = append(visHeroes, h)
		}
	}

	visNpcs := make([]Npc, 0)
	for _, n := range b.state.Npcs {
		if Manhattan(n.Position, hero.Position) <= R {
			visNpcs = append(visNpcs, n)
		}
	}

	visItems := make([]FloorItem, 0)
	for _, fi := range b.state.FloorItems {
		if Manhattan(fi.Position, hero.Position) <= R {
			visItems = append(visItems, fi)
		}
	}

	recent := b.state.Events
	if len(recent) > 8 {
		recent = recent[len(recent)-8:]
	}
	rev := make([]EventRecord, len(recent))
	for i, e := range recent {
		rev[len(recent)-1-i] = e
	}

	return &VisionData{
		Seed:             b.state.Seed,
		Turn:             b.state.Turn,
		Hero:             hero,
		VisibleTiles:     tiles,
		VisibleMonsters:  visMonsters,
		VisibleHeroes:    visHeroes,
		VisibleNpcs:      visNpcs,
		VisibleItems:     visItems,
		RecentEvents:     rev,
		LegalActions:     b.getLegalActions(hero),
		SpellDiscoveries: b.activeSpellDiscoveries(heroID),
	}, nil
}

// GetLandmarks returns up to n notable map features for the board.
// The result is deterministic per board (sorted by position) and identical for all heroes.
func (b *Board) GetLandmarks(n int) []Landmark {
	b.mu.RLock()
	defer b.mu.RUnlock()

	var landmarks []Landmark

	// Collect notable tile positions
	notableTiles := map[TileKind]string{
		TileShrine:      "shrine",
		TileExit:        "dungeon exit",
		TileTreasure:    "treasure cache",
		TileChest:       "chest",
		TileChestLocked: "locked chest",
		TileMerchant:    "merchant stall",
		TileLava:        "lava pool",
	}
	for y := 0; y < b.state.Map.Height; y++ {
		for x := 0; x < b.state.Map.Width; x++ {
			tile := b.state.Map.Tiles[y][x]
			if name, ok := notableTiles[tile]; ok {
				landmarks = append(landmarks, Landmark{Kind: string(tile), Name: name, Position: Position{x, y}})
			}
		}
	}

	// Collect NPCs as landmarks
	for _, npc := range b.state.Npcs {
		landmarks = append(landmarks, Landmark{Kind: string(npc.Kind), Name: npc.Name, Position: npc.Position})
	}

	// Already sorted by scan order (top-to-bottom, left-to-right for tiles, then NPCs appended).
	// Trim to n.
	if len(landmarks) > n {
		landmarks = landmarks[:n]
	}
	return landmarks
}

// GetAllHeroPositions returns the position and name of every living hero on the board.
func (b *Board) GetAllHeroPositions() []map[string]interface{} {
	b.mu.RLock()
	defer b.mu.RUnlock()

	result := make([]map[string]interface{}, 0, len(b.state.Heroes))
	for _, h := range b.state.Heroes {
		if h.Status != StatusAlive {
			continue
		}
		result = append(result, map[string]interface{}{
			"id":       h.ID,
			"name":     h.Name,
			"position": h.Position,
		})
	}
	return result
}

// activeSpellDiscoveries returns non-expired spell discoveries for a hero.
// Caller must hold b.mu (read or write).
func (b *Board) activeSpellDiscoveries(heroID string) []SpellDiscovery {
	if b.state.SpellDiscoveries == nil {
		return nil
	}
	all := b.state.SpellDiscoveries[heroID]
	if len(all) == 0 {
		return nil
	}
	active := make([]SpellDiscovery, 0, len(all))
	for _, d := range all {
		if b.state.Turn-d.DiscoveredTurn <= CFG.SpellDiscoveryDuration {
			active = append(active, d)
		}
	}
	if len(active) == 0 {
		return nil
	}
	return active
}

func (b *Board) getLegalActions(hero *HeroProfile) []LegalAction {
	if hero.Status != StatusAlive {
		return []LegalAction{}
	}
	actions := make([]LegalAction, 0)

	// Move directions
	for _, dir := range AllDirections {
		target := MoveInDir(hero.Position, dir)
		if target.Y < 0 || target.Y >= b.state.Map.Height || target.X < 0 || target.X >= b.state.Map.Width {
			continue
		}
		tile := b.state.Map.Tiles[target.Y][target.X]
		if tile == TileWall {
			continue
		}
		if tile == TileDoorLocked && !hasItem(hero, ItemKey) {
			continue
		}
		if tile == TileChestLocked && !hasItem(hero, ItemKey) {
			continue
		}
		occupiedByMonster := false
		for _, m := range b.state.Monsters {
			if m.Hp > 0 && m.Position.X == target.X && m.Position.Y == target.Y {
				occupiedByMonster = true
				break
			}
		}
		if occupiedByMonster {
			continue
		}

		desc := fmt.Sprintf("Move %s", dir)
		switch tile {
		case TileDoorClosed:
			desc += " (opens door)"
		case TileDoorLocked:
			desc += " (uses key, opens locked door)"
		case TileTreasure:
			desc += " (treasure +10!)"
		case TilePotion:
			desc += " (health potion)"
		case TileExit:
			desc += " (ESCAPE the dungeon!)"
		case TileChest:
			desc += " (open chest)"
		case TileChestLocked:
			desc += " (open locked chest, uses key)"
		case TileLava:
			desc += " (LAVA: -10 HP!)"
		case TileShallowWater:
			desc += " (water, +fatigue)"
		case TileTrapVisible:
			desc += " (TRAP: -4 HP)"
		}

		actions = append(actions, LegalAction{HeroAction: HeroAction{Kind: ActionMove, Direction: dir}, Description: desc})
	}

	// Attack adjacent monsters
	for _, m := range b.state.Monsters {
		if m.Hp <= 0 {
			continue
		}
		if Manhattan(hero.Position, m.Position) <= 1 {
			actions = append(actions, LegalAction{
				HeroAction:  HeroAction{Kind: ActionAttack, TargetID: m.ID},
				Description: fmt.Sprintf("Attack %s the %s (%d/%d HP, ATK %d DEF %d)", m.Name, m.Kind, m.Hp, m.MaxHp, m.Attack, m.Defense),
			})
		}
	}

	// Use items
	for _, item := range hero.Inventory {
		if item.Consumable {
			actions = append(actions, LegalAction{
				HeroAction:  HeroAction{Kind: ActionUseItem, ItemID: item.ID},
				Description: fmt.Sprintf("Use %s: %s", item.Name, item.Description),
			})
		} else if item.Slot != "" {
			current := getEquipmentSlot(hero, item.Slot)
			desc := ""
			if current != nil {
				desc = fmt.Sprintf("Equip %s (replace %s): %s", item.Name, current.Name, item.Description)
			} else {
				desc = fmt.Sprintf("Equip %s: %s", item.Name, item.Description)
			}
			actions = append(actions, LegalAction{
				HeroAction:  HeroAction{Kind: ActionUseItem, ItemID: item.ID},
				Description: desc,
			})
		}
	}

	// Interact with NPCs
	for _, npc := range b.state.Npcs {
		if Manhattan(hero.Position, npc.Position) > 1 {
			continue
		}
		alreadyInteracted := false
		for _, hid := range npc.InteractedBy {
			if hid == hero.ID {
				alreadyInteracted = true
				break
			}
		}
		if alreadyInteracted {
			continue
		}
		switch npc.Kind {
		case NpcShrine:
			actions = append(actions, LegalAction{
				HeroAction:  HeroAction{Kind: ActionInteract, TargetID: npc.ID},
				Description: fmt.Sprintf("Pray at %s (heal %d HP + shield)", npc.Name, CFG.ShrineHeal),
			})
		case NpcMerchant:
			actions = append(actions, LegalAction{
				HeroAction:  HeroAction{Kind: ActionInteract, TargetID: npc.ID},
				Description: fmt.Sprintf("Trade with %s (buy items with gold)", npc.Name),
			})
		case NpcPrisoner:
			actions = append(actions, LegalAction{
				HeroAction:  HeroAction{Kind: ActionInteract, TargetID: npc.ID},
				Description: fmt.Sprintf("Free %s (quest reward)", npc.Name),
			})
		}
	}

	// Rest + wait
	restHeal := CFG.RestHeal
	if hero.Stats.MaxHp-hero.Stats.Hp < restHeal {
		restHeal = hero.Stats.MaxHp - hero.Stats.Hp
	}
	actions = append(actions, LegalAction{
		HeroAction:  HeroAction{Kind: ActionRest},
		Description: fmt.Sprintf("Rest (heal %d HP, reduce fatigue by %d)", restHeal, CFG.FatigueRestReduction),
	})
	actions = append(actions, LegalAction{
		HeroAction:  HeroAction{Kind: ActionWait},
		Description: fmt.Sprintf("Wait (reduce fatigue by %d)", CFG.FatigueWaitReduction),
	})

	// Spells (each costs one turn)
	actions = append(actions,
		LegalAction{
			HeroAction:  HeroAction{Kind: ActionCastSpell, SpellKind: SpellLocateTreasury},
			Description: "Cast Locate Treasury: reveal positions of all treasures and chests",
		},
		LegalAction{
			HeroAction:  HeroAction{Kind: ActionCastSpell, SpellKind: SpellLocateMonsters},
			Description: "Cast Locate Monsters: reveal positions of all living monsters (decays over time)",
		},
		LegalAction{
			HeroAction:  HeroAction{Kind: ActionCastSpell, SpellKind: SpellLocateHeroes},
			Description: "Cast Locate Heroes: reveal positions of all living heroes (decays over time)",
		},
		LegalAction{
			HeroAction:  HeroAction{Kind: ActionCastSpell, SpellKind: SpellLocateBuildings},
			Description: "Cast Locate Buildings: reveal positions of shrines, merchants, exits",
		},
	)

	// Only offer prisoner spell if there is an unrescued prisoner
	for _, npc := range b.state.Npcs {
		if npc.Kind == NpcPrisoner {
			rescued := false
			for _, hid := range npc.InteractedBy {
				if hid != "" {
					rescued = true
					break
				}
			}
			if !rescued {
				actions = append(actions, LegalAction{
					HeroAction:  HeroAction{Kind: ActionCastSpell, SpellKind: SpellLocatePrisoner},
					Description: "Cast Locate Prisoner: reveal position of the prisoner",
				})
				break
			}
		}
	}

	return actions
}

func actionsMatch(submitted HeroAction, legal HeroAction) bool {
	return submitted.Kind == legal.Kind &&
		submitted.Direction == legal.Direction &&
		submitted.TargetID == legal.TargetID &&
		submitted.ItemID == legal.ItemID &&
		submitted.SpellKind == legal.SpellKind
}

func (b *Board) isLegalActionLocked(hero *HeroProfile, action HeroAction) bool {
	for _, legal := range b.getLegalActions(hero) {
		if actionsMatch(action, legal.HeroAction) {
			return true
		}
	}
	return false
}

// SubmitAction queues a hero's action for the next turn.
func (b *Board) SubmitAction(heroID string, action HeroAction) (bool, string) {
	b.mu.Lock()
	defer b.mu.Unlock()

	var hero *HeroProfile
	for i := range b.state.Heroes {
		if b.state.Heroes[i].ID == heroID {
			hero = &b.state.Heroes[i]
			break
		}
	}
	if hero == nil {
		return false, "unknown hero"
	}
	if hero.Status != StatusAlive {
		return false, fmt.Sprintf("%s is %s", hero.Name, hero.Status)
	}
	if _, exists := b.state.PendingActions[hero.ID]; exists {
		return false, fmt.Sprintf("action already queued for turn %d", b.state.Turn)
	}
	if !b.isLegalActionLocked(hero, action) {
		return false, "illegal action for current board state"
	}
	b.state.PendingActions[hero.ID] = action
	b.state.Events = append(b.state.Events, EventRecord{
		ID:      NewID(),
		Turn:    b.state.Turn,
		Type:    EventSystem,
		Summary: fmt.Sprintf("[BOT] %s decided: %s", hero.Name, summarizeAction(hero, action)),
	})
	if len(b.state.Events) > CFG.MaxEvents {
		b.state.Events = b.state.Events[len(b.state.Events)-CFG.MaxEvents:]
	}
	return true, fmt.Sprintf("%s queued", action.Kind)
}

func summarizeAction(hero *HeroProfile, action HeroAction) string {
	switch action.Kind {
	case ActionMove:
		if action.Direction == "" {
			return "move"
		}
		from := hero.Position
		to := MoveInDir(from, action.Direction)
		return fmt.Sprintf("move %s from (%d,%d) to (%d,%d)", action.Direction, from.X, from.Y, to.X, to.Y)
	case ActionAttack:
		if action.TargetID == "" {
			return "attack"
		}
		return fmt.Sprintf("attack target %s", action.TargetID)
	case ActionUseItem:
		if action.ItemID == "" {
			return "use item"
		}
		return fmt.Sprintf("use item %s", action.ItemID)
	case ActionInteract:
		if action.TargetID == "" {
			return "interact"
		}
		return fmt.Sprintf("interact with %s", action.TargetID)
	case ActionRest:
		return "rest"
	case ActionWait:
		return "wait"
	case ActionCastSpell:
		if action.SpellKind == "" {
			return "cast spell"
		}
		return fmt.Sprintf("cast %s", action.SpellKind)
	default:
		return string(action.Kind)
	}
}

// StepWorld advances the board one turn.
func (b *Board) StepWorld() {
	b.mu.Lock()
	defer b.mu.Unlock()
	b.state = ResolveTurn(b.state)
}

// AddSystemEvent adds a system event to the board.
func (b *Board) AddSystemEvent(summary string) {
	b.mu.Lock()
	defer b.mu.Unlock()
	b.state.Events = append(b.state.Events, EventRecord{
		ID:      NewID(),
		Turn:    b.state.Turn,
		Type:    EventSystem,
		Summary: summary,
	})
	if len(b.state.Events) > CFG.MaxEvents {
		b.state.Events = b.state.Events[len(b.state.Events)-CFG.MaxEvents:]
	}
}

// AddBotMessage records a bot chat message.
func (b *Board) AddBotMessage(heroID, message string) {
	b.mu.Lock()
	defer b.mu.Unlock()
	var heroName string
	for _, h := range b.state.Heroes {
		if h.ID == heroID {
			heroName = h.Name
			break
		}
	}
	if heroName == "" {
		return
	}
	b.botMessages = append(b.botMessages, BotMessage{
		ID:       NewID(),
		HeroID:   heroID,
		HeroName: heroName,
		Turn:     b.state.Turn,
		Message:  message,
	})
	if len(b.botMessages) > 80 {
		b.botMessages = b.botMessages[len(b.botMessages)-80:]
	}
}

// AllHerosDoneOrDead returns true if every hero is dead or escaped.
func (b *Board) AllHeroesDoneOrDead() bool {
	b.mu.RLock()
	defer b.mu.RUnlock()
	if len(b.state.Heroes) == 0 {
		return false
	}
	for _, h := range b.state.Heroes {
		if h.Status == StatusAlive {
			return false
		}
	}
	return true
}

func hasItem(hero *HeroProfile, kind ItemKind) bool {
	for _, it := range hero.Inventory {
		if it.Kind == kind {
			return true
		}
	}
	return false
}

func abs(x int) int {
	if x < 0 {
		return -x
	}
	return x
}

func max(a, b int) int {
	if a > b {
		return a
	}
	return b
}

func min(a, b int) int {
	if a < b {
		return a
	}
	return b
}

// GenerateBoardID creates a short readable board ID using the provided RNG.
func GenerateBoardID(rng *Rng) string {
	words := []string{"alpha", "bravo", "delta", "echo", "frost", "gamma", "iron", "jade", "nova", "onyx", "pulse", "rune", "sigma", "titan", "ultra", "vex", "warp", "xenon", "zeta"}
	w := rng.Pick(words)
	n := rng.Int(1, 999)
	return fmt.Sprintf("%s-%03d", strings.ToUpper(w[:1])+w[1:], n)
}
