package game

import (
	"fmt"
	"strings"
	"testing"
)

func TestRegisterHeroAppliesDocumentedTraitBonusesAndDefaultTrait(t *testing.T) {
	tests := []struct {
		name      string
		trait     HeroTrait
		wantTrait HeroTrait
		wantStats HeroStats
	}{
		{name: "default curious", trait: "", wantTrait: TraitCurious, wantStats: HeroStats{MaxHp: 40, Hp: 40, Attack: 5, Defense: 3, Speed: 4, Perception: 7}},
		{name: "aggressive", trait: TraitAggressive, wantTrait: TraitAggressive, wantStats: HeroStats{MaxHp: 40, Hp: 40, Attack: 7, Defense: 2, Speed: 3, Perception: 5}},
		{name: "cautious", trait: TraitCautious, wantTrait: TraitCautious, wantStats: HeroStats{MaxHp: 50, Hp: 50, Attack: 5, Defense: 5, Speed: 3, Perception: 6}},
		{name: "greedy", trait: TraitGreedy, wantTrait: TraitGreedy, wantStats: HeroStats{MaxHp: 40, Hp: 40, Attack: 5, Defense: 3, Speed: 4, Perception: 6}},
		{name: "resilient", trait: TraitResilient, wantTrait: TraitResilient, wantStats: HeroStats{MaxHp: 55, Hp: 55, Attack: 5, Defense: 4, Speed: 3, Perception: 5}},
	}

	for _, tt := range tests {
		board := newBoardWithState("trait-" + tt.name)
		hero, err := board.RegisterHero(HeroRegistration{ID: EntityID("hero-" + strings.ReplaceAll(tt.name, " ", "-")), Name: tt.name, Strategy: "test", PreferredTrait: tt.trait})
		if err != nil {
			t.Fatalf("%s: register hero: %v", tt.name, err)
		}
		if hero.Trait != tt.wantTrait {
			t.Fatalf("%s: trait = %q, want %q", tt.name, hero.Trait, tt.wantTrait)
		}
		if hero.Stats != tt.wantStats {
			t.Fatalf("%s: stats = %+v, want %+v", tt.name, hero.Stats, tt.wantStats)
		}
	}
}

func TestRegisterHeroRespawnsDeadHeroWithDocumentedResetRules(t *testing.T) {
	board := newBoardWithState("respawn-seed")
	hero, err := board.RegisterHero(HeroRegistration{ID: "hero-respawn", Name: "RespawnHero", Strategy: "test", PreferredTrait: TraitAggressive})
	if err != nil {
		t.Fatalf("register hero: %v", err)
	}

	board.state.Heroes[0].Status = StatusDead
	board.state.Heroes[0].Gold = 19
	board.state.Heroes[0].Inventory = []Item{MakeItem(ItemKey), MakeItem(ItemHealthPotion)}
	board.state.Heroes[0].Equipment.Weapon = func() *Item { item := MakeItem(ItemSword); return &item }()
	board.state.Heroes[0].Effects = []StatusEffect{{Kind: EffPoison, TurnsRemaining: 2, Magnitude: 3}}
	board.state.Heroes[0].Fatigue = 77
	board.state.Heroes[0].Morale = 12
	board.state.Heroes[0].Position = Position{X: 3, Y: 3}

	respawned, err := board.RegisterHero(HeroRegistration{ID: hero.ID, Name: hero.Name, Strategy: hero.Strategy, PreferredTrait: TraitAggressive})
	if err != nil {
		t.Fatalf("respawn hero: %v", err)
	}
	updated := board.state.Heroes[0]
	if respawned.Status != StatusAlive || updated.Status != StatusAlive {
		t.Fatalf("respawned status = %q, want alive", updated.Status)
	}
	if updated.Stats != CFG.HeroBaseStats || updated.BaseStats != CFG.HeroBaseStats {
		t.Fatalf("respawned stats = %+v base=%+v, want %+v", updated.Stats, updated.BaseStats, CFG.HeroBaseStats)
	}
	if len(updated.Inventory) != 0 || updated.Equipment != (HeroEquipment{}) || len(updated.Effects) != 0 {
		t.Fatalf("respawned hero should have empty inventory/equipment/effects, got inventory=%v equipment=%+v effects=%v", updated.Inventory, updated.Equipment, updated.Effects)
	}
	if updated.Fatigue != 0 || updated.Morale != CFG.MoraleStart {
		t.Fatalf("respawned fatigue/morale = %d/%d, want 0/%d", updated.Fatigue, updated.Morale, CFG.MoraleStart)
	}
	if updated.Gold != 9 {
		t.Fatalf("respawned gold = %d, want 9", updated.Gold)
	}
	if updated.LastAction != "respawned" {
		t.Fatalf("last action = %q, want respawned", updated.LastAction)
	}
}

func TestGetVisionLegalActionsExposeDocumentedDescriptions(t *testing.T) {
	board := newBoardWithState("legal-actions-seed")
	hero := newTestHero("hero-legal", "LegalHero", Position{X: 3, Y: 3})
	hero.Inventory = []Item{MakeItem(ItemKey), MakeItem(ItemHealthPotion)}
	board.state.Heroes = []HeroProfile{hero}
	board.state.Map.Tiles[3][2] = TileDoorLocked
	board.state.Map.Tiles[2][3] = TileExit
	board.state.Map.Tiles[3][4] = TileTrapVisible
	board.state.Map.Tiles[4][3] = TileShallowWater

	vision, err := board.GetVision(hero.ID)
	if err != nil {
		t.Fatalf("get vision: %v", err)
	}
	descriptions := make([]string, 0, len(vision.LegalActions))
	for _, action := range vision.LegalActions {
		descriptions = append(descriptions, action.Description)
	}

	expected := []string{
		"Move west (uses key, opens locked door)",
		"Move north (ESCAPE the dungeon!)",
		"Move east (TRAP: -4 HP)",
		"Move south (water, +fatigue)",
		"Use Health Potion: Restores 20 HP",
	}
	for _, want := range expected {
		found := false
		for _, desc := range descriptions {
			if desc == want {
				found = true
				break
			}
		}
		if !found {
			t.Fatalf("missing legal action description %q in %v", want, descriptions)
		}
	}
}

func TestGetVisionLegalActionsIncludeAttackDescriptionsForAdjacentMonsters(t *testing.T) {
	board := newBoardWithState("legal-attack-seed")
	hero := newTestHero("hero-attack-legal", "AttackLegalHero", Position{X: 3, Y: 3})
	board.state.Heroes = []HeroProfile{hero}
	board.state.Monsters = []Monster{{ID: "monster-legal", Slug: "goblin-legal", Kind: MonGoblin, Name: "LegalGoblin", Hp: 8, MaxHp: 8, Attack: 3, Defense: 1, Speed: 3, Behavior: BehaviorPatrol, Position: Position{X: 4, Y: 3}, AlertRange: 5}}

	vision, err := board.GetVision(hero.ID)
	if err != nil {
		t.Fatalf("get vision: %v", err)
	}
	found := false
	for _, action := range vision.LegalActions {
		if action.Description == "Attack LegalGoblin the goblin (8/8 HP, ATK 3 DEF 1)" {
			found = true
			break
		}
	}
	if !found {
		t.Fatalf("missing adjacent attack description in legal actions: %v", vision.LegalActions)
	}
}

func TestGetVisionLegalActionsRejectHeroVsHeroAttack(t *testing.T) {
	board := newBoardWithState("no-pvp-seed")
	hero := newTestHero("hero-no-pvp", "NoPvpHero", Position{X: 3, Y: 3})
	rival := newTestHero("hero-rival", "RivalHero", Position{X: 4, Y: 3})
	board.state.Heroes = []HeroProfile{hero, rival}

	vision, err := board.GetVision(hero.ID)
	if err != nil {
		t.Fatalf("get vision: %v", err)
	}
	for _, action := range vision.LegalActions {
		if action.Kind == ActionAttack {
			t.Fatalf("unexpected attack action against another hero in legal actions: %+v", action)
		}
	}

	accepted, msg := board.SubmitAction(hero.ID, HeroAction{Kind: ActionAttack, TargetID: rival.ID})
	if accepted {
		t.Fatalf("hero-vs-hero attack unexpectedly accepted")
	}
	if msg != "illegal action for current board state" {
		t.Fatalf("hero-vs-hero rejection = %q, want %q", msg, "illegal action for current board state")
	}
}

func TestCanMonsterWalkRejectsTreasureAndOtherNonMonsterTiles(t *testing.T) {
	board := newBoardWithState("monster-walk-seed")
	pos := Position{X: 3, Y: 3}
	tests := []struct {
		name string
		tile TileKind
		want bool
	}{
		{name: "floor", tile: TileFloor, want: true},
		{name: "open door", tile: TileDoorOpen, want: true},
		{name: "treasure", tile: TileTreasure, want: false},
		{name: "potion", tile: TilePotion, want: false},
		{name: "chest", tile: TileChest, want: false},
		{name: "locked chest", tile: TileChestLocked, want: false},
		{name: "exit", tile: TileExit, want: false},
		{name: "shrine", tile: TileShrine, want: false},
		{name: "merchant", tile: TileMerchant, want: false},
		{name: "lava", tile: TileLava, want: false},
	}

	for _, tt := range tests {
		board.state.Map.Tiles[pos.Y][pos.X] = tt.tile
		if got := canMonsterWalk(pos, board.state); got != tt.want {
			t.Fatalf("%s: canMonsterWalk(%q) = %v, want %v", tt.name, tt.tile, got, tt.want)
		}
	}
}

func TestBuildLeaderboardMatchesDocumentedFormula(t *testing.T) {
	board := newBoardWithState("leaderboard-seed")
	hero := newTestHero("hero-score", "ScoreHero", Position{X: 2, Y: 2})
	hero.Score = 86
	hero.Gold = 17
	hero.Kills = 3
	hero.TilesExplored = 27
	hero.TurnsSurvived = 11
	hero.Status = StatusEscaped
	board.state.Heroes = []HeroProfile{hero}
	board.state.Quests = []Quest{{ID: "quest-score", HeroID: hero.ID, Description: "Rescue", Completed: true, Reward: QuestReward{Score: 25, Gold: 15}}}

	tracks := board.buildLeaderboard()
	if len(tracks) != 1 {
		t.Fatalf("leaderboard length = %d, want 1", len(tracks))
	}
	track := tracks[0]
	if track.TotalScore != 90 {
		t.Fatalf("total score = %d, want 90", track.TotalScore)
	}
	if track.CombatScore != 15 {
		t.Fatalf("combat score = %d, want 15", track.CombatScore)
	}
	if track.TreasureScore != 17 {
		t.Fatalf("treasure score = %d, want 17", track.TreasureScore)
	}
	if track.ExplorationScore != 2 {
		t.Fatalf("exploration score = %d, want 2", track.ExplorationScore)
	}
	if track.QuestScore != 25 {
		t.Fatalf("quest score = %d, want 25", track.QuestScore)
	}
	if !track.Escaped || track.Status != StatusEscaped {
		t.Fatalf("expected escaped track, got escaped=%v status=%q", track.Escaped, track.Status)
	}
}

func newTestMap(width, height int) GameMap {
	tiles := make([][]TileKind, height)
	for y := 0; y < height; y++ {
		row := make([]TileKind, width)
		for x := 0; x < width; x++ {
			if x == 0 || y == 0 || x == width-1 || y == height-1 {
				row[x] = TileWall
			} else {
				row[x] = TileFloor
			}
		}
		tiles[y] = row
	}
	return GameMap{Width: width, Height: height, Tiles: tiles}
}

func newTestHero(id, name string, pos Position) HeroProfile {
	base := CFG.HeroBaseStats
	return HeroProfile{
		ID:            id,
		Name:          name,
		Strategy:      "test",
		Trait:         TraitCurious,
		Stats:         base,
		BaseStats:     base,
		Position:      pos,
		Inventory:     []Item{},
		Equipment:     HeroEquipment{},
		Effects:       []StatusEffect{},
		Morale:        CFG.MoraleStart,
		Status:        StatusAlive,
		LastAction:    "entered",
		TurnsSurvived: 0,
	}
}

func newBoardWithState(seed string) *Board {
	return &Board{
		ID:        "Test-Board",
		state:     &BoardState{Seed: seed, DungeonName: "Test Dungeon", Turn: 1, Map: newTestMap(7, 7), Monsters: []Monster{}, Heroes: []HeroProfile{}, Npcs: []Npc{}, FloorItems: []FloorItem{}, Quests: []Quest{}, Events: []EventRecord{}, PendingActions: make(map[EntityID]HeroAction)},
		rng:       NewRng(seed + ":board"),
		lifecycle: LifecycleOpen,
		maxHeroes: 4,
	}
}

func hasEventContaining(events []EventRecord, needle string) bool {
	for _, event := range events {
		if strings.Contains(event.Summary, needle) {
			return true
		}
	}
	return false
}

func getVisibleTileKind(vision *VisionData, x, y int) (TileKind, bool) {
	for _, tile := range vision.VisibleTiles {
		if tile.X == x && tile.Y == y {
			return tile.Kind, true
		}
	}
	return "", false
}

func hasItemKind(items []Item, kind ItemKind) bool {
	for _, item := range items {
		if item.Kind == kind {
			return true
		}
	}
	return false
}

func TestResolveTurnMerchantBuysMostExpensiveAffordableItem(t *testing.T) {
	board := newBoardWithState("merchant-seed")
	hero := newTestHero("hero-merchant", "MerchantHero", Position{X: 2, Y: 2})
	hero.Gold = 20
	board.state.Heroes = []HeroProfile{hero}
	merchant := Npc{
		ID:           "merchant-1",
		Kind:         NpcMerchant,
		Name:         "Darkmarket Dez",
		Position:     Position{X: 3, Y: 2},
		Inventory:    []Item{MakeItem(ItemHealthPotion), MakeItem(ItemScrollTeleport), MakeItem(ItemKey)},
		InteractedBy: []EntityID{},
	}
	board.state.Npcs = []Npc{merchant}

	accepted, msg := board.SubmitAction(hero.ID, HeroAction{Kind: ActionInteract, TargetID: merchant.ID})
	if !accepted {
		t.Fatalf("submit interact: %s", msg)
	}

	board.StepWorld()

	updated := board.state.Heroes[0]
	if updated.Gold != 0 {
		t.Fatalf("gold after purchase = %d, want 0", updated.Gold)
	}
	if len(updated.Inventory) != 1 {
		t.Fatalf("inventory length = %d, want 1", len(updated.Inventory))
	}
	if updated.Inventory[0].Kind != ItemScrollTeleport {
		t.Fatalf("bought item = %q, want %q", updated.Inventory[0].Kind, ItemScrollTeleport)
	}
	if !strings.Contains(updated.LastAction, "bought Scroll of Teleport") {
		t.Fatalf("last action = %q, want purchase message", updated.LastAction)
	}
	if len(board.state.Npcs[0].Inventory) != 2 {
		t.Fatalf("merchant inventory length = %d, want 2", len(board.state.Npcs[0].Inventory))
	}
	if len(board.state.Npcs[0].InteractedBy) != 1 || board.state.Npcs[0].InteractedBy[0] != hero.ID {
		t.Fatalf("merchant interaction tracking = %v, want [%s]", board.state.Npcs[0].InteractedBy, hero.ID)
	}
	if !hasEventContaining(board.state.Events, "MerchantHero bought Scroll of Teleport from Darkmarket Dez") {
		t.Fatalf("expected purchase event, events=%v", board.state.Events)
	}
}

func TestResolveTurnShrineHealsAndAddsShield(t *testing.T) {
	board := newBoardWithState("shrine-seed")
	hero := newTestHero("hero-shrine", "ShrineHero", Position{X: 2, Y: 2})
	hero.Stats.Hp = 20
	board.state.Heroes = []HeroProfile{hero}
	shrine := Npc{ID: "shrine-1", Kind: NpcShrine, Name: "Moonwell", Position: Position{X: 3, Y: 2}, InteractedBy: []EntityID{}}
	board.state.Npcs = []Npc{shrine}

	accepted, msg := board.SubmitAction(hero.ID, HeroAction{Kind: ActionInteract, TargetID: shrine.ID})
	if !accepted {
		t.Fatalf("submit shrine interact: %s", msg)
	}

	board.StepWorld()

	updated := board.state.Heroes[0]
	if updated.Stats.Hp != 35 {
		t.Fatalf("hp after shrine = %d, want 35", updated.Stats.Hp)
	}
	if updated.Morale != CFG.MoraleStart+CFG.MoraleShrine {
		t.Fatalf("morale after shrine = %d, want %d", updated.Morale, CFG.MoraleStart+CFG.MoraleShrine)
	}
	if len(updated.Effects) != 1 || updated.Effects[0].Kind != EffShield || updated.Effects[0].TurnsRemaining != 3 {
		t.Fatalf("effects after shrine = %+v, want shield for 3 turns", updated.Effects)
	}
	if !hasEventContaining(board.state.Events, "ShrineHero prayed at Moonwell") {
		t.Fatalf("expected shrine interaction event, events=%v", board.state.Events)
	}
}

func TestResolveTurnLockedDoorConsumesKeyAndMovesHero(t *testing.T) {
	board := newBoardWithState("door-seed")
	hero := newTestHero("hero-door", "DoorHero", Position{X: 2, Y: 2})
	hero.Inventory = []Item{MakeItem(ItemKey)}
	board.state.Heroes = []HeroProfile{hero}
	board.state.Map.Tiles[2][3] = TileDoorLocked

	accepted, msg := board.SubmitAction(hero.ID, HeroAction{Kind: ActionMove, Direction: East})
	if !accepted {
		t.Fatalf("submit move east: %s", msg)
	}

	board.StepWorld()

	updated := board.state.Heroes[0]
	if updated.Position != (Position{X: 3, Y: 2}) {
		t.Fatalf("hero position = %+v, want {3 2}", updated.Position)
	}
	if len(updated.Inventory) != 0 {
		t.Fatalf("inventory length after unlock = %d, want 0", len(updated.Inventory))
	}
	if board.state.Map.Tiles[2][3] != TileDoorOpen {
		t.Fatalf("door tile = %q, want %q", board.state.Map.Tiles[2][3], TileDoorOpen)
	}
	if !hasEventContaining(board.state.Events, "DoorHero unlocked a door") {
		t.Fatalf("expected unlock event, events=%v", board.state.Events)
	}
	if !hasEventContaining(board.state.Events, "[BOT] DoorHero moved east") {
		t.Fatalf("expected movement event, events=%v", board.state.Events)
	}
}

func TestResolveTurnAttackKillCompletesQuestAndRewardsHero(t *testing.T) {
	board := newBoardWithState("combat-seed")
	hero := newTestHero("hero-combat", "CombatHero", Position{X: 2, Y: 2})
	board.state.Heroes = []HeroProfile{hero}
	monster := Monster{
		ID:       "monster-1",
		Slug:     "goblin-spark-monster-1",
		Kind:     MonGoblin,
		Name:     "Spark",
		Hp:       1,
		MaxHp:    8,
		Attack:   3,
		Defense:  0,
		Speed:    2,
		XpReward: 5,
		GoldDrop: 4,
		Behavior: BehaviorGuard,
		Position: Position{X: 3, Y: 2},
	}
	board.state.Monsters = []Monster{monster}
	board.state.Quests = []Quest{{
		ID:          "quest-1",
		HeroID:      hero.ID,
		Description: "Slay a goblin",
		Objective:   QuestObjective{Type: "kill", MonsterKind: MonGoblin, Count: 1},
		Reward:      QuestReward{Score: 11, Gold: 7},
	}}

	accepted, msg := board.SubmitAction(hero.ID, HeroAction{Kind: ActionAttack, TargetID: monster.ID})
	if !accepted {
		t.Fatalf("submit attack: %s", msg)
	}

	board.StepWorld()

	updated := board.state.Heroes[0]
	if updated.Kills != 1 {
		t.Fatalf("kills = %d, want 1", updated.Kills)
	}
	if updated.Score != 16 {
		t.Fatalf("score = %d, want 16", updated.Score)
	}
	if updated.Gold != 11 {
		t.Fatalf("gold = %d, want 11", updated.Gold)
	}
	if len(board.state.Monsters) != 0 {
		t.Fatalf("remaining monsters = %d, want 0 after cleanup", len(board.state.Monsters))
	}
	if !board.state.Quests[0].Completed {
		t.Fatalf("quest was not completed")
	}
	if !hasEventContaining(board.state.Events, "CombatHero completed quest: Slay a goblin") {
		t.Fatalf("expected quest completion event, events=%v", board.state.Events)
	}
}

func TestResolveTurnEscapeAwardsBonusAndStatus(t *testing.T) {
	board := newBoardWithState("escape-seed")
	hero := newTestHero("hero-escape", "EscapeHero", Position{X: 2, Y: 2})
	board.state.Heroes = []HeroProfile{hero}
	board.state.Map.Tiles[2][3] = TileExit

	accepted, msg := board.SubmitAction(hero.ID, HeroAction{Kind: ActionMove, Direction: East})
	if !accepted {
		t.Fatalf("submit exit move: %s", msg)
	}

	board.StepWorld()

	updated := board.state.Heroes[0]
	if updated.Status != StatusEscaped {
		t.Fatalf("status = %q, want %q", updated.Status, StatusEscaped)
	}
	if updated.Score != CFG.EscapeBonus {
		t.Fatalf("score = %d, want %d", updated.Score, CFG.EscapeBonus)
	}
	if !hasEventContaining(board.state.Events, "EscapeHero escaped the dungeon") {
		t.Fatalf("expected escape event, events=%v", board.state.Events)
	}
}

func TestResolveTurnRescueQuestCompletesForPrisoner(t *testing.T) {
	board := newBoardWithState("rescue-seed")
	hero := newTestHero("hero-rescue", "RescueHero", Position{X: 2, Y: 2})
	board.state.Heroes = []HeroProfile{hero}
	prisoner := Npc{ID: "prisoner-1", Kind: NpcPrisoner, Name: "Sir Aldric", Position: Position{X: 3, Y: 2}, InteractedBy: []EntityID{}}
	board.state.Npcs = []Npc{prisoner}
	board.state.Quests = []Quest{{
		ID:          "quest-rescue",
		HeroID:      hero.ID,
		Description: "Rescue Sir Aldric",
		Objective:   QuestObjective{Type: "rescue", NpcID: prisoner.ID},
		Reward:      QuestReward{Score: 25, Gold: 15},
	}}

	accepted, msg := board.SubmitAction(hero.ID, HeroAction{Kind: ActionInteract, TargetID: prisoner.ID})
	if !accepted {
		t.Fatalf("submit prisoner interact: %s", msg)
	}

	board.StepWorld()

	updated := board.state.Heroes[0]
	if updated.Score != 25 {
		t.Fatalf("score = %d, want 25", updated.Score)
	}
	if updated.Gold != 15 {
		t.Fatalf("gold = %d, want 15", updated.Gold)
	}
	if !board.state.Quests[0].Completed || !board.state.Quests[0].Objective.Done {
		t.Fatalf("quest state = %+v, want completed rescue quest", board.state.Quests[0])
	}
	if !hasEventContaining(board.state.Events, "RescueHero completed rescue quest") {
		t.Fatalf("expected rescue quest event, events=%v", board.state.Events)
	}
}

func TestResolveTurnUseAntidoteRemovesOnlyPoison(t *testing.T) {
	board := newBoardWithState("antidote-seed")
	hero := newTestHero("hero-antidote", "AntidoteHero", Position{X: 2, Y: 2})
	hero.Effects = []StatusEffect{
		{Kind: EffPoison, TurnsRemaining: 3, Magnitude: 2},
		{Kind: EffShield, TurnsRemaining: 2, Magnitude: 3},
	}
	hero.Inventory = []Item{MakeItem(ItemAntidote)}
	board.state.Heroes = []HeroProfile{hero}

	accepted, msg := board.SubmitAction(hero.ID, HeroAction{Kind: ActionUseItem, ItemID: hero.Inventory[0].ID})
	if !accepted {
		t.Fatalf("submit antidote use: %s", msg)
	}

	board.StepWorld()

	updated := board.state.Heroes[0]
	if hasItemKind(updated.Inventory, ItemAntidote) {
		t.Fatalf("antidote should be consumed, inventory=%v", updated.Inventory)
	}
	if len(updated.Effects) != 1 || updated.Effects[0].Kind != EffShield {
		t.Fatalf("effects after antidote = %+v, want only shield remaining", updated.Effects)
	}
	if updated.LastAction != "antidote - cured poison" {
		t.Fatalf("last action = %q, want antidote message", updated.LastAction)
	}
	if !hasEventContaining(board.state.Events, "AntidoteHero cured poison") {
		t.Fatalf("expected antidote event, events=%v", board.state.Events)
	}
}

func TestResolveTurnUseTeleportScrollMovesHeroToOnlySafeFloor(t *testing.T) {
	board := newBoardWithState("teleport-seed")
	board.state.Map = newTestMap(5, 5)
	for y := 1; y < board.state.Map.Height-1; y++ {
		for x := 1; x < board.state.Map.Width-1; x++ {
			board.state.Map.Tiles[y][x] = TileWall
		}
	}
	board.state.Map.Tiles[2][2] = TileShallowWater
	board.state.Map.Tiles[3][3] = TileFloor

	hero := newTestHero("hero-teleport", "TeleportHero", Position{X: 2, Y: 2})
	hero.Inventory = []Item{MakeItem(ItemScrollTeleport)}
	board.state.Heroes = []HeroProfile{hero}

	accepted, msg := board.SubmitAction(hero.ID, HeroAction{Kind: ActionUseItem, ItemID: hero.Inventory[0].ID})
	if !accepted {
		t.Fatalf("submit teleport scroll: %s", msg)
	}

	board.StepWorld()

	updated := board.state.Heroes[0]
	if updated.Position != (Position{X: 3, Y: 3}) {
		t.Fatalf("teleport position = %+v, want {3 3}", updated.Position)
	}
	if hasItemKind(updated.Inventory, ItemScrollTeleport) {
		t.Fatalf("teleport scroll should be consumed, inventory=%v", updated.Inventory)
	}
	if updated.LastAction != "teleported!" {
		t.Fatalf("last action = %q, want teleported!", updated.LastAction)
	}
	if !hasEventContaining(board.state.Events, "TeleportHero teleported away") {
		t.Fatalf("expected teleport event, events=%v", board.state.Events)
	}
}

func TestResolveTurnLockedChestConsumesKeyAndAddsLoot(t *testing.T) {
	board := newBoardWithState("locked-chest-seed")
	hero := newTestHero("hero-chest", "ChestHero", Position{X: 2, Y: 2})
	key := MakeItem(ItemKey)
	hero.Inventory = []Item{key}
	board.state.Heroes = []HeroProfile{hero}
	board.state.Map.Tiles[2][3] = TileChestLocked

	accepted, msg := board.SubmitAction(hero.ID, HeroAction{Kind: ActionMove, Direction: East})
	if !accepted {
		t.Fatalf("submit locked chest move: %s", msg)
	}

	board.StepWorld()

	updated := board.state.Heroes[0]
	if updated.Position != (Position{X: 3, Y: 2}) {
		t.Fatalf("hero position = %+v, want {3 2}", updated.Position)
	}
	for _, item := range updated.Inventory {
		if item.ID == key.ID {
			t.Fatalf("original key item should be consumed when opening locked chest, inventory=%v", updated.Inventory)
		}
	}
	if len(updated.Inventory) == 0 {
		t.Fatalf("expected locked chest to add loot, inventory=%v", updated.Inventory)
	}
	if board.state.Map.Tiles[2][3] != TileChestOpen {
		t.Fatalf("chest tile = %q, want %q", board.state.Map.Tiles[2][3], TileChestOpen)
	}
	if !hasEventContaining(board.state.Events, "locked chest") {
		t.Fatalf("expected locked chest loot event, events=%v", board.state.Events)
	}
}

func TestResolveTurnScrollRevealExposesNearbyHiddenTraps(t *testing.T) {
	board := newBoardWithState("reveal-seed")
	hero := newTestHero("hero-reveal", "RevealHero", Position{X: 3, Y: 3})
	scroll := MakeItem(ItemScrollReveal)
	hero.Inventory = []Item{scroll}
	board.state.Heroes = []HeroProfile{hero}
	board.state.Map.Tiles[3][4] = TileTrapHidden
	board.state.Map.Tiles[1][1] = TileTrapHidden

	accepted, msg := board.SubmitAction(hero.ID, HeroAction{Kind: ActionUseItem, ItemID: scroll.ID})
	if !accepted {
		t.Fatalf("submit reveal scroll: %s", msg)
	}

	board.StepWorld()

	updated := board.state.Heroes[0]
	if hasItemKind(updated.Inventory, ItemScrollReveal) {
		t.Fatalf("scroll of reveal should be consumed, inventory=%v", updated.Inventory)
	}
	if board.state.Map.Tiles[3][4] != TileTrapVisible {
		t.Fatalf("near trap tile = %q, want %q", board.state.Map.Tiles[3][4], TileTrapVisible)
	}
	if board.state.Map.Tiles[1][1] != TileTrapVisible {
		t.Fatalf("far trap within reveal radius tile = %q, want %q", board.state.Map.Tiles[1][1], TileTrapVisible)
	}
	if !strings.Contains(updated.LastAction, "scroll of reveal") {
		t.Fatalf("last action = %q, want reveal summary", updated.LastAction)
	}
	if !hasEventContaining(board.state.Events, "RevealHero used Scroll of Reveal") {
		t.Fatalf("expected reveal event, events=%v", board.state.Events)
	}
}

func TestResolveTurnVisibleTrapTriggersReducedDamageAndTileChange(t *testing.T) {
	board := newBoardWithState("visible-trap-seed")
	hero := newTestHero("hero-trap", "TrapHero", Position{X: 2, Y: 2})
	board.state.Heroes = []HeroProfile{hero}
	board.state.Map.Tiles[2][3] = TileTrapVisible

	accepted, msg := board.SubmitAction(hero.ID, HeroAction{Kind: ActionMove, Direction: East})
	if !accepted {
		t.Fatalf("submit visible trap move: %s", msg)
	}

	board.StepWorld()

	updated := board.state.Heroes[0]
	if updated.Position != (Position{X: 3, Y: 2}) {
		t.Fatalf("hero position = %+v, want {3 2}", updated.Position)
	}
	if updated.Stats.Hp != updated.Stats.MaxHp-CFG.TrapVisibleDamage {
		t.Fatalf("hp after visible trap = %d, want %d", updated.Stats.Hp, updated.Stats.MaxHp-CFG.TrapVisibleDamage)
	}
	if board.state.Map.Tiles[2][3] != TileTrapTriggered {
		t.Fatalf("trap tile = %q, want %q", board.state.Map.Tiles[2][3], TileTrapTriggered)
	}
	if !hasEventContaining(board.state.Events, "TrapHero walked through a visible trap") {
		t.Fatalf("expected visible trap event, events=%v", board.state.Events)
	}
}

func TestResolveTurnMonsterBehaviorsMoveAndAttackDeterministically(t *testing.T) {
	board := newBoardWithState("monster-behavior-seed")
	board.state.Map = newTestMap(12, 12)
	heroes := []HeroProfile{
		newTestHero("hero-chase", "HeroChase", Position{X: 2, Y: 2}),
		newTestHero("hero-patrol", "HeroPatrol", Position{X: 2, Y: 5}),
		newTestHero("hero-ambush", "HeroAmbush", Position{X: 10, Y: 2}),
		newTestHero("hero-guard", "HeroGuard", Position{X: 10, Y: 6}),
		newTestHero("hero-flee", "HeroFlee", Position{X: 6, Y: 8}),
	}
	board.state.Heroes = heroes
	board.state.Monsters = []Monster{
		{ID: "mon-chase", Slug: "goblin-chase", Kind: MonGoblin, Name: "Chase", Hp: 8, MaxHp: 8, Attack: 3, Defense: 1, Speed: 3, Behavior: BehaviorChase, Position: Position{X: 5, Y: 2}, AlertRange: 5},
		{ID: "mon-patrol", Slug: "goblin-patrol", Kind: MonGoblin, Name: "Patrol", Hp: 8, MaxHp: 8, Attack: 3, Defense: 1, Speed: 3, Behavior: BehaviorPatrol, Position: Position{X: 5, Y: 5}, AlertRange: 5},
		{ID: "mon-ambush", Slug: "spider-ambush", Kind: MonSpider, Name: "Ambush", Hp: 6, MaxHp: 6, Attack: 4, Defense: 0, Speed: 4, Behavior: BehaviorAmbush, Position: Position{X: 10, Y: 4}, AlertRange: 3},
		{ID: "mon-guard", Slug: "skeleton-guard", Kind: MonSkeleton, Name: "Guard", Hp: 12, MaxHp: 12, Attack: 4, Defense: 2, Speed: 2, Behavior: BehaviorGuard, Position: Position{X: 10, Y: 8}, AlertRange: 5},
		{ID: "mon-flee", Slug: "goblin-flee", Kind: MonGoblin, Name: "Flee", Hp: 1, MaxHp: 8, Attack: 3, Defense: 1, Speed: 3, Behavior: BehaviorFlee, Position: Position{X: 8, Y: 8}, AlertRange: 5},
	}

	board.StepWorld()

	positions := map[string]Position{}
	for _, monster := range board.state.Monsters {
		positions[monster.ID] = monster.Position
	}
	if got := positions["mon-chase"]; got != (Position{X: 4, Y: 2}) {
		t.Fatalf("chase monster position = %+v, want {4 2}", got)
	}
	if got := positions["mon-patrol"]; got != (Position{X: 4, Y: 5}) {
		t.Fatalf("patrol monster position = %+v, want {4 5}", got)
	}
	if got := positions["mon-ambush"]; got != (Position{X: 10, Y: 3}) {
		t.Fatalf("ambush monster position = %+v, want {10 3}", got)
	}
	if got := positions["mon-guard"]; got != (Position{X: 10, Y: 7}) {
		t.Fatalf("guard monster position = %+v, want {10 7}", got)
	}
	if got := positions["mon-flee"]; got != (Position{X: 9, Y: 8}) {
		t.Fatalf("flee monster position = %+v, want {9 8}", got)
	}
	if !hasEventContaining(board.state.Events, "goblin-chase") || !hasEventContaining(board.state.Events, "closes in") {
		t.Fatalf("expected chase movement event, events=%v", board.state.Events)
	}
	if !hasEventContaining(board.state.Events, "goblin-patrol") || !hasEventContaining(board.state.Events, "advances") {
		t.Fatalf("expected patrol movement event, events=%v", board.state.Events)
	}
	if !hasEventContaining(board.state.Events, "spider-ambush") || !hasEventContaining(board.state.Events, "lunges from cover") {
		t.Fatalf("expected ambush movement event, events=%v", board.state.Events)
	}
	if !hasEventContaining(board.state.Events, "skeleton-guard") || !hasEventContaining(board.state.Events, "repositions") {
		t.Fatalf("expected guard movement event, events=%v", board.state.Events)
	}
	if !hasEventContaining(board.state.Events, "goblin-flee") || !hasEventContaining(board.state.Events, "retreats") {
		t.Fatalf("expected low-hp flee override event, events=%v", board.state.Events)
	}
}

func TestResolveTurnAdjacentMonsterAttacksHero(t *testing.T) {
	board := newBoardWithState("adjacent-attack-seed")
	board.state.Map = newTestMap(7, 7)
	hero := newTestHero("hero-adjacent", "HeroAdjacent", Position{X: 3, Y: 3})
	board.state.Heroes = []HeroProfile{hero}
	board.state.Monsters = []Monster{{
		ID:         "mon-adjacent",
		Slug:       "orc-adjacent",
		Kind:       MonOrc,
		Name:       "Adjacent",
		Hp:         20,
		MaxHp:      20,
		Attack:     6,
		Defense:    3,
		Speed:      2,
		Behavior:   BehaviorGuard,
		Position:   Position{X: 4, Y: 3},
		AlertRange: 5,
	}}

	board.StepWorld()

	updated := board.state.Heroes[0]
	if updated.Stats.Hp >= updated.Stats.MaxHp {
		t.Fatalf("adjacent hero hp = %d, want damage from adjacent monster", updated.Stats.Hp)
	}
	if !hasEventContaining(board.state.Events, "orc-adjacent") || !hasEventContaining(board.state.Events, "HeroAdjacent") {
		t.Fatalf("expected adjacent attack event, events=%v", board.state.Events)
	}
}

func TestBoardScriptedHeroesMixedEscapeAndDeathSmoke(t *testing.T) {
	board := newBoardWithState("mixed-end-seed")
	board.state.Map = newTestMap(8, 8)
	escaper := newTestHero("hero-escape-smoke", "EscapeSmoke", Position{X: 2, Y: 2})
	doomed := newTestHero("hero-doomed-smoke", "DoomedSmoke", Position{X: 4, Y: 4})
	doomed.Stats.Hp = 1
	board.state.Heroes = []HeroProfile{escaper, doomed}
	board.state.Map.Tiles[2][3] = TileExit
	board.state.Map.Tiles[4][5] = TileTrapHidden

	accepted, msg := board.SubmitAction(escaper.ID, HeroAction{Kind: ActionMove, Direction: East})
	if !accepted {
		t.Fatalf("submit escape action: %s", msg)
	}
	accepted, msg = board.SubmitAction(doomed.ID, HeroAction{Kind: ActionMove, Direction: East})
	if !accepted {
		t.Fatalf("submit doomed action: %s", msg)
	}

	board.StepWorld()

	if board.state.Heroes[0].Status != StatusEscaped {
		t.Fatalf("escape hero status = %q, want %q", board.state.Heroes[0].Status, StatusEscaped)
	}
	if board.state.Heroes[1].Status != StatusDead {
		t.Fatalf("doomed hero status = %q, want %q", board.state.Heroes[1].Status, StatusDead)
	}
	if !board.AllHeroesDoneOrDead() {
		t.Fatalf("expected all heroes to be finished after mixed end-state turn")
	}
	if !hasEventContaining(board.state.Events, "EscapeSmoke escaped the dungeon") {
		t.Fatalf("expected escape event, events=%v", board.state.Events)
	}
	if !hasEventContaining(board.state.Events, "DoomedSmoke was killed by a trap") {
		t.Fatalf("expected trap death event, events=%v", board.state.Events)
	}
	assertBoardInvariants(t, board)
}

func TestGetVisionHidesHiddenTrapUntilPerceptionThreshold(t *testing.T) {
	board := newBoardWithState("vision-seed")
	hero := newTestHero("hero-vision", "VisionHero", Position{X: 2, Y: 2})
	board.state.Heroes = []HeroProfile{hero}
	board.state.Map.Tiles[2][3] = TileTrapHidden

	vision, err := board.GetVision(hero.ID)
	if err != nil {
		t.Fatalf("get vision: %v", err)
	}
	kind, ok := getVisibleTileKind(vision, 3, 2)
	if !ok {
		t.Fatalf("trap tile not visible in low-perception vision")
	}
	if kind != TileFloor {
		t.Fatalf("visible kind with low perception = %q, want %q", kind, TileFloor)
	}

	board.state.Heroes[0].Stats.Perception = CFG.PerceptionTrapThreshold
	vision, err = board.GetVision(hero.ID)
	if err != nil {
		t.Fatalf("get vision with threshold perception: %v", err)
	}
	kind, ok = getVisibleTileKind(vision, 3, 2)
	if !ok {
		t.Fatalf("trap tile not visible in high-perception vision")
	}
	if kind != TileTrapHidden {
		t.Fatalf("visible kind with high perception = %q, want %q", kind, TileTrapHidden)
	}
}

func chooseScriptedAction(t *testing.T, board *Board, heroID string) HeroAction {
	t.Helper()

	vision, err := board.GetVision(heroID)
	if err != nil {
		t.Fatalf("get vision for %s: %v", heroID, err)
	}
	actions := vision.LegalActions
	if len(actions) == 0 {
		return HeroAction{Kind: ActionWait}
	}

	hero := vision.Hero
	moveByDir := make(map[Direction]LegalAction)
	for _, action := range actions {
		if action.Kind == ActionMove {
			moveByDir[action.Direction] = action
		}
	}

	if hero.Stats.Hp <= hero.Stats.MaxHp/2 {
		for _, action := range actions {
			if action.Kind == ActionUseItem && strings.Contains(action.Description, "Health Potion") {
				return action.HeroAction
			}
		}
	}

	if hero.Score >= 20 {
		for _, action := range actions {
			if action.Kind == ActionMove && strings.Contains(action.Description, "ESCAPE") {
				return action.HeroAction
			}
		}
	}

	for _, action := range actions {
		if action.Kind == ActionInteract && strings.Contains(action.Description, "Free") {
			return action.HeroAction
		}
	}
	for _, action := range actions {
		if action.Kind == ActionInteract && strings.Contains(action.Description, "Trade") && hero.Gold >= 10 {
			return action.HeroAction
		}
	}
	for _, action := range actions {
		if action.Kind == ActionInteract && strings.Contains(action.Description, "Pray") && (hero.Stats.Hp < hero.Stats.MaxHp || hero.Morale < CFG.MoraleHigh) {
			return action.HeroAction
		}
	}

	for _, action := range actions {
		if action.Kind == ActionAttack {
			return action.HeroAction
		}
	}

	for _, action := range actions {
		if action.Kind == ActionUseItem && strings.Contains(action.Description, "Equip") {
			return action.HeroAction
		}
	}

	for _, action := range actions {
		if action.Kind != ActionMove {
			continue
		}
		if strings.Contains(action.Description, "treasure") || strings.Contains(action.Description, "health potion") || strings.Contains(action.Description, "open chest") || strings.Contains(action.Description, "ESCAPE") {
			return action.HeroAction
		}
	}

	type target struct {
		pos    Position
		weight int
	}
	var targets []target
	for _, item := range vision.VisibleItems {
		targets = append(targets, target{pos: item.Position, weight: 0})
	}
	for _, tile := range vision.VisibleTiles {
		switch tile.Kind {
		case TileTreasure, TilePotion, TileChest, TileChestLocked, TileExit:
			targets = append(targets, target{pos: Position{X: tile.X, Y: tile.Y}, weight: 1})
		}
	}
	for _, npc := range vision.VisibleNpcs {
		targets = append(targets, target{pos: npc.Position, weight: 2})
	}
	for _, monster := range vision.VisibleMonsters {
		targets = append(targets, target{pos: monster.Position, weight: 3})
	}

	bestDir := Direction("")
	bestScore := 1 << 30
	for _, candidate := range targets {
		dx := candidate.pos.X - hero.Position.X
		dy := candidate.pos.Y - hero.Position.Y
		preferredDirs := []Direction{}
		if abs(dx) >= abs(dy) {
			if dx > 0 {
				preferredDirs = append(preferredDirs, East)
			} else if dx < 0 {
				preferredDirs = append(preferredDirs, West)
			}
			if dy > 0 {
				preferredDirs = append(preferredDirs, South)
			} else if dy < 0 {
				preferredDirs = append(preferredDirs, North)
			}
		} else {
			if dy > 0 {
				preferredDirs = append(preferredDirs, South)
			} else if dy < 0 {
				preferredDirs = append(preferredDirs, North)
			}
			if dx > 0 {
				preferredDirs = append(preferredDirs, East)
			} else if dx < 0 {
				preferredDirs = append(preferredDirs, West)
			}
		}
		for rank, dir := range preferredDirs {
			if _, ok := moveByDir[dir]; !ok {
				continue
			}
			score := candidate.weight*100 + Manhattan(hero.Position, candidate.pos)*10 + rank
			if score < bestScore {
				bestScore = score
				bestDir = dir
			}
			break
		}
	}
	if bestDir != "" {
		return moveByDir[bestDir].HeroAction
	}

	fallbackDirs := []Direction{East, South, West, North}
	shift := hero.TurnsSurvived % len(fallbackDirs)
	for i := 0; i < len(fallbackDirs); i++ {
		dir := fallbackDirs[(i+shift)%len(fallbackDirs)]
		if action, ok := moveByDir[dir]; ok {
			return action.HeroAction
		}
	}

	if hero.Stats.Hp < hero.Stats.MaxHp {
		for _, action := range actions {
			if action.Kind == ActionRest {
				return action.HeroAction
			}
		}
	}

	return actions[0].HeroAction
}

func assertBoardInvariants(t *testing.T, board *Board) {
	t.Helper()

	if len(board.state.PendingActions) != 0 {
		t.Fatalf("pending actions not cleared after step: %v", board.state.PendingActions)
	}

	occupiedHeroes := make(map[string]string)
	for _, hero := range board.state.Heroes {
		if hero.Position.X < 0 || hero.Position.X >= board.state.Map.Width || hero.Position.Y < 0 || hero.Position.Y >= board.state.Map.Height {
			t.Fatalf("hero %s out of bounds at %+v", hero.Name, hero.Position)
		}
		if hero.Stats.Hp < 0 || hero.Stats.Hp > hero.Stats.MaxHp {
			t.Fatalf("hero %s hp = %d/%d, want bounded hp", hero.Name, hero.Stats.Hp, hero.Stats.MaxHp)
		}
		if hero.Status == StatusAlive {
			key := fmt.Sprintf("%d,%d", hero.Position.X, hero.Position.Y)
			if other, exists := occupiedHeroes[key]; exists {
				t.Fatalf("alive heroes overlap on %s: %s and %s", key, hero.Name, other)
			}
			occupiedHeroes[key] = hero.Name
		}
	}

	occupiedMonsters := make(map[string]string)
	for _, monster := range board.state.Monsters {
		if monster.Hp <= 0 {
			continue
		}
		if monster.Position.X < 0 || monster.Position.X >= board.state.Map.Width || monster.Position.Y < 0 || monster.Position.Y >= board.state.Map.Height {
			t.Fatalf("monster %s out of bounds at %+v", monster.Name, monster.Position)
		}
		key := fmt.Sprintf("%d,%d", monster.Position.X, monster.Position.Y)
		if other, exists := occupiedMonsters[key]; exists {
			t.Fatalf("alive monsters overlap on %s: %s and %s", key, monster.Name, other)
		}
		occupiedMonsters[key] = monster.Name
		if _, exists := occupiedHeroes[key]; exists {
			t.Fatalf("hero and monster overlap on %s", key)
		}
	}
}

func TestBoardScriptedHeroesSmokeFixedSeed(t *testing.T) {
	board := NewBoard("Smoke-001", "smoke-seed", 4)
	registrations := []HeroRegistration{
		{ID: "smoke-a", Name: "Smoke-A", Strategy: "scripted", PreferredTrait: TraitAggressive},
		{ID: "smoke-b", Name: "Smoke-B", Strategy: "scripted", PreferredTrait: TraitCautious},
		{ID: "smoke-c", Name: "Smoke-C", Strategy: "scripted", PreferredTrait: TraitGreedy},
		{ID: "smoke-d", Name: "Smoke-D", Strategy: "scripted", PreferredTrait: TraitResilient},
	}
	for _, registration := range registrations {
		if _, err := board.RegisterHero(registration); err != nil {
			t.Fatalf("register %s: %v", registration.Name, err)
		}
	}

	progressObserved := false
	for board.Turn() < CFG.MaxTurnsPerBoard && !board.AllHeroesDoneOrDead() {
		for _, hero := range board.state.Heroes {
			if hero.Status != StatusAlive {
				continue
			}
			action := chooseScriptedAction(t, board, hero.ID)
			accepted, msg := board.SubmitAction(hero.ID, action)
			if !accepted {
				t.Fatalf("submit action for %s on turn %d: %s (%+v)", hero.Name, board.Turn(), msg, action)
			}
		}

		previousTurn := board.Turn()
		board.StepWorld()
		if board.Turn() != previousTurn+1 {
			t.Fatalf("turn advanced from %d to %d, want %d", previousTurn, board.Turn(), previousTurn+1)
		}
		assertBoardInvariants(t, board)

		for _, hero := range board.state.Heroes {
			if hero.TilesExplored > 0 || hero.Score > 0 || hero.Kills > 0 || hero.Status != StatusAlive {
				progressObserved = true
				break
			}
		}
	}

	if !progressObserved {
		t.Fatalf("scripted smoke test made no visible progress")
	}
	if board.Turn() < 2 {
		t.Fatalf("board turn = %d, want at least 2 after smoke run", board.Turn())
	}
	if !board.AllHeroesDoneOrDead() && board.Turn() != CFG.MaxTurnsPerBoard {
		t.Fatalf("smoke run ended early at turn %d without heroes finishing", board.Turn())
	}
	if len(board.state.Events) == 0 {
		t.Fatalf("expected smoke run to emit events")
	}
}

func TestBoardScriptedHeroesInteractionHeavySmoke(t *testing.T) {
	board := newBoardWithState("interaction-heavy-seed")
	board.state.Map = newTestMap(9, 9)

	merchantHero := newTestHero("hero-merchant-smoke", "MerchantSmoke", Position{X: 2, Y: 2})
	merchantHero.Gold = 5
	shrineHero := newTestHero("hero-shrine-smoke", "ShrineSmoke", Position{X: 2, Y: 6})
	shrineHero.Stats.Hp = 20
	board.state.Heroes = []HeroProfile{merchantHero, shrineHero}

	merchant := Npc{
		ID:           "merchant-smoke",
		Kind:         NpcMerchant,
		Name:         "Old Sacks",
		Position:     Position{X: 2, Y: 3},
		Inventory:    []Item{MakeItem(ItemKey)},
		InteractedBy: []EntityID{},
	}
	shrine := Npc{ID: "shrine-smoke", Kind: NpcShrine, Name: "Spirit Fountain", Position: Position{X: 2, Y: 5}, InteractedBy: []EntityID{}}
	prisoner := Npc{ID: "prisoner-smoke", Kind: NpcPrisoner, Name: "Wren the Scout", Position: Position{X: 5, Y: 6}, InteractedBy: []EntityID{}}
	board.state.Npcs = []Npc{merchant, shrine, prisoner}
	board.state.Map.Tiles[2][3] = TileChestLocked
	board.state.Quests = []Quest{{
		ID:          "quest-smoke-rescue",
		HeroID:      shrineHero.ID,
		Description: "Rescue Wren the Scout",
		Objective:   QuestObjective{Type: "rescue", NpcID: prisoner.ID},
		Reward:      QuestReward{Score: 25, Gold: 15},
	}}

	type scriptedTurn struct {
		heroID string
		action HeroAction
	}
	turns := [][]scriptedTurn{
		{{heroID: merchantHero.ID, action: HeroAction{Kind: ActionInteract, TargetID: merchant.ID}}, {heroID: shrineHero.ID, action: HeroAction{Kind: ActionInteract, TargetID: shrine.ID}}},
		{{heroID: merchantHero.ID, action: HeroAction{Kind: ActionMove, Direction: East}}, {heroID: shrineHero.ID, action: HeroAction{Kind: ActionMove, Direction: East}}},
		{{heroID: merchantHero.ID, action: HeroAction{Kind: ActionWait}}, {heroID: shrineHero.ID, action: HeroAction{Kind: ActionMove, Direction: East}}},
		{{heroID: merchantHero.ID, action: HeroAction{Kind: ActionWait}}, {heroID: shrineHero.ID, action: HeroAction{Kind: ActionMove, Direction: East}}},
		{{heroID: merchantHero.ID, action: HeroAction{Kind: ActionWait}}, {heroID: shrineHero.ID, action: HeroAction{Kind: ActionInteract, TargetID: prisoner.ID}}},
	}

	for turnIndex, actions := range turns {
		for _, scripted := range actions {
			accepted, msg := board.SubmitAction(scripted.heroID, scripted.action)
			if !accepted {
				t.Fatalf("turn %d submit for %s failed: %s (%+v)", turnIndex+1, scripted.heroID, msg, scripted.action)
			}
		}
		board.StepWorld()
		assertBoardInvariants(t, board)
	}

	updatedMerchant := board.state.Heroes[0]
	updatedShrine := board.state.Heroes[1]
	if !hasEventContaining(board.state.Events, "MerchantSmoke bought Rusty Key from Old Sacks") {
		t.Fatalf("expected merchant buy event, events=%v", board.state.Events)
	}
	if !hasEventContaining(board.state.Events, "ShrineSmoke prayed at Spirit Fountain") {
		t.Fatalf("expected shrine interaction event, events=%v", board.state.Events)
	}
	if !hasEventContaining(board.state.Events, "locked chest") {
		t.Fatalf("expected locked chest event, events=%v", board.state.Events)
	}
	if !hasEventContaining(board.state.Events, "ShrineSmoke completed rescue quest") {
		t.Fatalf("expected rescue quest completion event, events=%v", board.state.Events)
	}
	if updatedMerchant.Position != (Position{X: 3, Y: 2}) {
		t.Fatalf("merchant hero position = %+v, want {3 2}", updatedMerchant.Position)
	}
	if updatedShrine.Score != 25 || updatedShrine.Gold != 15 {
		t.Fatalf("shrine hero rewards = score %d gold %d, want 25/15", updatedShrine.Score, updatedShrine.Gold)
	}
	if !board.state.Quests[0].Completed {
		t.Fatalf("interaction-heavy smoke quest should be completed")
	}
}
