package game

import "testing"

func TestBoardSubmitActionRejectsIllegalAction(t *testing.T) {
	board := NewBoard("Test-002", "seed-test", 4)
	hero, err := board.RegisterHero(HeroRegistration{
		ID:       EntityID("hero-illegal"),
		Name:     "Hero-Illegal",
		Strategy: "test",
	})
	if err != nil {
		t.Fatalf("register hero: %v", err)
	}

	accepted, msg := board.SubmitAction(hero.ID, HeroAction{Kind: ActionAttack, TargetID: EntityID("missing-monster")})
	if accepted {
		t.Fatalf("illegal action unexpectedly accepted")
	}
	if msg != "illegal action for current board state" {
		t.Fatalf("illegal submit message = %q, want %q", msg, "illegal action for current board state")
	}
	if _, exists := board.state.PendingActions[hero.ID]; exists {
		t.Fatalf("illegal action was queued")
	}
}

func TestBoardSubmitActionRejectsSecondActionSameTurn(t *testing.T) {
	board := NewBoard("Test-001", "seed-test", 4)
	hero, err := board.RegisterHero(HeroRegistration{
		ID:       EntityID("hero-1"),
		Name:     "Hero-1",
		Strategy: "test",
	})
	if err != nil {
		t.Fatalf("register hero: %v", err)
	}

	accepted, msg := board.SubmitAction(hero.ID, HeroAction{Kind: ActionWait})
	if !accepted {
		t.Fatalf("first submit rejected: %s", msg)
	}

	accepted, msg = board.SubmitAction(hero.ID, HeroAction{Kind: ActionRest})
	if accepted {
		t.Fatalf("second submit unexpectedly accepted")
	}
	if msg != "action already queued for turn 1" {
		t.Fatalf("second submit message = %q, want %q", msg, "action already queued for turn 1")
	}

	queued := board.state.PendingActions[hero.ID]
	if queued.Kind != ActionWait {
		t.Fatalf("queued action kind = %q, want %q", queued.Kind, ActionWait)
	}
}

func TestBoardStepWorldAutoEquipsFloorItemWithoutInventoryDuplicate(t *testing.T) {
	board := NewBoard("Test-003", "seed-test", 4)
	hero, err := board.RegisterHero(HeroRegistration{
		ID:       EntityID("hero-equip"),
		Name:     "Hero-Equip",
		Strategy: "test",
	})
	if err != nil {
		t.Fatalf("register hero: %v", err)
	}

	board.state.Monsters = nil
	board.state.FloorItems = []FloorItem{{
		ID:       NewID(),
		Item:     MakeItem(ItemRingVision),
		Position: Position{X: 2, Y: 1},
	}}
	board.state.Heroes[0].Position = Position{X: 1, Y: 1}
	board.state.Map.Tiles[1][1] = TileFloor
	board.state.Map.Tiles[1][2] = TileFloor

	accepted, msg := board.SubmitAction(hero.ID, HeroAction{Kind: ActionMove, Direction: East})
	if !accepted {
		t.Fatalf("submit move east: %s", msg)
	}

	board.StepWorld()

	updated := board.state.Heroes[0]
	if updated.Equipment.Accessory == nil {
		t.Fatalf("expected accessory to be equipped")
	}
	if updated.Equipment.Accessory.Kind != ItemRingVision {
		t.Fatalf("equipped accessory kind = %q, want %q", updated.Equipment.Accessory.Kind, ItemRingVision)
	}
	if len(updated.Inventory) != 0 {
		t.Fatalf("inventory length = %d, want 0", len(updated.Inventory))
	}
	if len(board.state.FloorItems) != 0 {
		t.Fatalf("floor item was not removed")
	}
}

func TestBoardStepWorldAutoEquipWorksWhenInventoryIsFull(t *testing.T) {
	board := NewBoard("Test-004", "seed-test", 4)
	hero, err := board.RegisterHero(HeroRegistration{
		ID:       EntityID("hero-full"),
		Name:     "Hero-Full",
		Strategy: "test",
	})
	if err != nil {
		t.Fatalf("register hero: %v", err)
	}

	board.state.Monsters = nil
	board.state.Heroes[0].Position = Position{X: 1, Y: 1}
	board.state.Map.Tiles[1][1] = TileFloor
	board.state.Map.Tiles[1][2] = TileFloor
	for i := 0; i < CFG.InventoryLimit; i++ {
		board.state.Heroes[0].Inventory = append(board.state.Heroes[0].Inventory, MakeItem(ItemKey))
	}
	board.state.FloorItems = []FloorItem{{
		ID:       NewID(),
		Item:     MakeItem(ItemRingVision),
		Position: Position{X: 2, Y: 1},
	}}

	accepted, msg := board.SubmitAction(hero.ID, HeroAction{Kind: ActionMove, Direction: East})
	if !accepted {
		t.Fatalf("submit move east: %s", msg)
	}

	board.StepWorld()

	updated := board.state.Heroes[0]
	if updated.Equipment.Accessory == nil || updated.Equipment.Accessory.Kind != ItemRingVision {
		t.Fatalf("expected ring to auto-equip with full inventory")
	}
	if len(updated.Inventory) != CFG.InventoryLimit {
		t.Fatalf("inventory length = %d, want %d", len(updated.Inventory), CFG.InventoryLimit)
	}
}

func TestBoardEventsAfterIDReturnsNewEventsAfterTruncation(t *testing.T) {
	board := NewBoard("Test-005", "seed-test", 4)
	board.AddSystemEvent("marker")
	markerID := board.LastEventID()

	for i := 0; i < CFG.MaxEvents+5; i++ {
		board.AddSystemEvent("filler")
	}

	events := board.EventsAfterID(markerID)
	if len(events) == 0 {
		t.Fatal("expected events after truncated marker")
	}
	if got := events[len(events)-1].Summary; got != "filler" {
		t.Fatalf("last returned event = %q, want %q", got, "filler")
	}
	if len(events) != CFG.MaxEvents {
		t.Fatalf("returned events = %d, want %d", len(events), CFG.MaxEvents)
	}
}

func TestBoardNextStepTowardFindsDirectPath(t *testing.T) {
	board := newBoardWithState("path-direct")
	hero := newTestHero("hero-path", "PathHero", Position{X: 1, Y: 1})
	board.state.Heroes = []HeroProfile{hero}

	direction, ok := board.NextStepToward(hero.ID, []Position{{X: 4, Y: 1}})
	if !ok {
		t.Fatal("NextStepToward returned ok=false, want true")
	}
	if direction != East {
		t.Fatalf("direction = %s, want %s", direction, East)
	}
}

func TestBoardNextStepTowardAvoidsHazards(t *testing.T) {
	board := newBoardWithState("path-hazard")
	hero := newTestHero("hero-safe", "SafeHero", Position{X: 1, Y: 1})
	board.state.Heroes = []HeroProfile{hero}
	board.state.Map.Tiles[1][2] = TileLava

	direction, ok := board.NextStepToward(hero.ID, []Position{{X: 3, Y: 1}})
	if !ok {
		t.Fatal("NextStepToward returned ok=false, want true")
	}
	if direction != South {
		t.Fatalf("direction = %s, want %s", direction, South)
	}
}
