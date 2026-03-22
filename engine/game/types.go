package game

import "github.com/google/uuid"

// ── Identifiers ──

type EntityID = string
type Direction string

func NewID() string {
	return uuid.New().String()
}

func Clamp(v, min, max int) int {
	if v < min {
		return min
	}
	if v > max {
		return max
	}
	return v
}

var AllDirections = []Direction{North, South, East, West}

const (
	North Direction = "north"
	South Direction = "south"
	East  Direction = "east"
	West  Direction = "west"
)

type TurnPhase string

const (
	PhaseSubmit  TurnPhase = "submit"
	PhaseResolve TurnPhase = "resolve"
)

// ── Position ──

type Position struct {
	X int `json:"x"`
	Y int `json:"y"`
}

func Manhattan(a, b Position) int {
	dx := a.X - b.X
	dy := a.Y - b.Y
	if dx < 0 {
		dx = -dx
	}
	if dy < 0 {
		dy = -dy
	}
	return dx + dy
}

func MoveInDir(pos Position, dir Direction) Position {
	switch dir {
	case North:
		return Position{pos.X, pos.Y - 1}
	case South:
		return Position{pos.X, pos.Y + 1}
	case East:
		return Position{pos.X + 1, pos.Y}
	case West:
		return Position{pos.X - 1, pos.Y}
	}
	return pos
}

// ── Tiles ──

type TileKind string

const (
	TileFloor         TileKind = "floor"
	TileWall          TileKind = "wall"
	TileDoorClosed    TileKind = "door_closed"
	TileDoorLocked    TileKind = "door_locked"
	TileDoorOpen      TileKind = "door_open"
	TileTrapHidden    TileKind = "trap_hidden"
	TileTrapVisible   TileKind = "trap_visible"
	TileTrapTriggered TileKind = "trap_triggered"
	TileChest         TileKind = "chest"
	TileChestLocked   TileKind = "chest_locked"
	TileChestOpen     TileKind = "chest_open"
	TileTreasure      TileKind = "treasure"
	TilePotion        TileKind = "potion"
	TileShrine        TileKind = "shrine"
	TileMerchant      TileKind = "merchant"
	TileExit          TileKind = "exit"
	TileShallowWater  TileKind = "shallow_water"
	TileLava          TileKind = "lava"
)

type GameMap struct {
	Width  int          `json:"width"`
	Height int          `json:"height"`
	Tiles  [][]TileKind `json:"tiles"`
}

// ── Status effects ──

type EffectKind string

const (
	EffPoison EffectKind = "poison"
	EffStun   EffectKind = "stun"
	EffShield EffectKind = "shield"
	EffHaste  EffectKind = "haste"
	EffRegen  EffectKind = "regen"
	EffBlind  EffectKind = "blind"
)

type StatusEffect struct {
	Kind           EffectKind `json:"kind"`
	TurnsRemaining int        `json:"turnsRemaining"`
	Magnitude      int        `json:"magnitude"`
}

// ── Items ──

type ItemSlot string

const (
	SlotWeapon    ItemSlot = "weapon"
	SlotArmor     ItemSlot = "armor"
	SlotAccessory ItemSlot = "accessory"
)

type ItemKind string

const (
	ItemHealthPotion     ItemKind = "health_potion"
	ItemAntidote         ItemKind = "antidote"
	ItemKey              ItemKind = "key"
	ItemScrollReveal     ItemKind = "scroll_reveal"
	ItemScrollTeleport   ItemKind = "scroll_teleport"
	ItemSword            ItemKind = "sword"
	ItemDagger           ItemKind = "dagger"
	ItemAxe              ItemKind = "axe"
	ItemStaff            ItemKind = "staff"
	ItemLeatherArmor     ItemKind = "leather_armor"
	ItemChainArmor       ItemKind = "chain_armor"
	ItemPlateArmor       ItemKind = "plate_armor"
	ItemRingVision       ItemKind = "ring_vision"
	ItemAmuletProtection ItemKind = "amulet_protection"
	ItemBootsSpeed       ItemKind = "boots_speed"
)

type StatBonus struct {
	MaxHp      int `json:"maxHp,omitempty"`
	Attack     int `json:"attack,omitempty"`
	Defense    int `json:"defense,omitempty"`
	Speed      int `json:"speed,omitempty"`
	Perception int `json:"perception,omitempty"`
}

type Item struct {
	ID          EntityID   `json:"id"`
	Kind        ItemKind   `json:"kind"`
	Name        string     `json:"name"`
	Slot        ItemSlot   `json:"slot,omitempty"`
	StatBonus   *StatBonus `json:"statBonus,omitempty"`
	Value       int        `json:"value"`
	Consumable  bool       `json:"consumable"`
	Description string     `json:"description"`
}

type FloorItem struct {
	ID       EntityID `json:"id"`
	Item     Item     `json:"item"`
	Position Position `json:"position"`
}

// ── Heroes ──

type HeroTrait string

const (
	TraitAggressive HeroTrait = "aggressive"
	TraitCautious   HeroTrait = "cautious"
	TraitGreedy     HeroTrait = "greedy"
	TraitCurious    HeroTrait = "curious"
	TraitResilient  HeroTrait = "resilient"
)

type HeroStats struct {
	MaxHp      int `json:"maxHp"`
	Hp         int `json:"hp"`
	Attack     int `json:"attack"`
	Defense    int `json:"defense"`
	Speed      int `json:"speed"`
	Perception int `json:"perception"`
}

type HeroEquipment struct {
	Weapon    *Item `json:"weapon"`
	Armor     *Item `json:"armor"`
	Accessory *Item `json:"accessory"`
}

type HeroStatus string

const (
	StatusAlive   HeroStatus = "alive"
	StatusDead    HeroStatus = "dead"
	StatusEscaped HeroStatus = "escaped"
)

type HeroProfile struct {
	ID             EntityID       `json:"id"`
	Name           string         `json:"name"`
	Strategy       string         `json:"strategy"`
	PreferredTrait HeroTrait      `json:"preferredTrait,omitempty"`
	Trait          HeroTrait      `json:"trait"`
	Stats          HeroStats      `json:"stats"`
	BaseStats      HeroStats      `json:"baseStats"`
	Position       Position       `json:"position"`
	Score          int            `json:"score"`
	Kills          int            `json:"kills"`
	TilesExplored  int            `json:"tilesExplored"`
	Gold           int            `json:"gold"`
	Inventory      []Item         `json:"inventory"`
	Equipment      HeroEquipment  `json:"equipment"`
	Effects        []StatusEffect `json:"effects"`
	Fatigue        int            `json:"fatigue"`
	Morale         int            `json:"morale"`
	Status         HeroStatus     `json:"status"`
	LastAction     string         `json:"lastAction"`
	TurnsSurvived  int            `json:"turnsSurvived"`
}

type HeroRegistration struct {
	ID             EntityID  `json:"id"`
	Name           string    `json:"name"`
	Strategy       string    `json:"strategy"`
	PreferredTrait HeroTrait `json:"preferredTrait,omitempty"`
}

// ── Monsters ──

type MonsterKind string

const (
	MonGoblin   MonsterKind = "goblin"
	MonSkeleton MonsterKind = "skeleton"
	MonOrc      MonsterKind = "orc"
	MonDragon   MonsterKind = "dragon"
	MonWraith   MonsterKind = "wraith"
	MonSpider   MonsterKind = "spider"
	MonMimic    MonsterKind = "mimic"
)

type MonsterBehavior string

const (
	BehaviorPatrol MonsterBehavior = "patrol"
	BehaviorChase  MonsterBehavior = "chase"
	BehaviorAmbush MonsterBehavior = "ambush"
	BehaviorGuard  MonsterBehavior = "guard"
	BehaviorFlee   MonsterBehavior = "flee"
)

type Monster struct {
	ID         EntityID        `json:"id"`
	Slug       string          `json:"slug,omitempty"`
	Kind       MonsterKind     `json:"kind"`
	Name       string          `json:"name"`
	Hp         int             `json:"hp"`
	MaxHp      int             `json:"maxHp"`
	Attack     int             `json:"attack"`
	Defense    int             `json:"defense"`
	Speed      int             `json:"speed"`
	XpReward   int             `json:"xpReward"`
	GoldDrop   int             `json:"goldDrop"`
	Behavior   MonsterBehavior `json:"behavior"`
	Position   Position        `json:"position"`
	Effects    []StatusEffect  `json:"effects"`
	Drops      []ItemKind      `json:"drops"`
	AlertRange int             `json:"alertRange"`
}

// ── NPCs ──

type NpcKind string

const (
	NpcMerchant NpcKind = "merchant"
	NpcShrine   NpcKind = "shrine"
	NpcPrisoner NpcKind = "prisoner"
)

type Npc struct {
	ID           EntityID   `json:"id"`
	Kind         NpcKind    `json:"kind"`
	Name         string     `json:"name"`
	Position     Position   `json:"position"`
	Inventory    []Item     `json:"inventory,omitempty"`
	InteractedBy []EntityID `json:"interactedBy"`
}

// ── Quests ──

type QuestObjective struct {
	Type        string      `json:"type"` // "kill" or "rescue"
	MonsterKind MonsterKind `json:"monsterKind,omitempty"`
	Count       int         `json:"count,omitempty"`
	Progress    int         `json:"progress,omitempty"`
	NpcID       EntityID    `json:"npcId,omitempty"`
	Done        bool        `json:"done,omitempty"`
}

type QuestReward struct {
	Score int      `json:"score"`
	Gold  int      `json:"gold"`
	Item  ItemKind `json:"item,omitempty"`
}

type Quest struct {
	ID          EntityID       `json:"id"`
	HeroID      EntityID       `json:"heroId"`
	Description string         `json:"description"`
	Objective   QuestObjective `json:"objective"`
	Reward      QuestReward    `json:"reward"`
	Completed   bool           `json:"completed"`
}

// ── Actions ──

type ActionKind string

const (
	ActionMove      ActionKind = "move"
	ActionAttack    ActionKind = "attack"
	ActionRest      ActionKind = "rest"
	ActionUseItem   ActionKind = "use_item"
	ActionInteract  ActionKind = "interact"
	ActionWait      ActionKind = "wait"
	ActionCastSpell ActionKind = "cast_spell"
)

// ── Spells ──

type SpellKind string

const (
	SpellLocateTreasury  SpellKind = "locate_treasury"
	SpellLocateMonsters  SpellKind = "locate_monsters"
	SpellLocateHeroes    SpellKind = "locate_heroes"
	SpellLocateBuildings SpellKind = "locate_buildings"
	SpellLocatePrisoner  SpellKind = "locate_prisoner"
)

// SpellDiscovery records locations discovered by casting a spell.
// Mobile entries (monsters, heroes) decay; static entries (treasury, buildings, prisoner) do not.
type SpellDiscovery struct {
	Spell          SpellKind  `json:"spell"`
	Positions      []Position `json:"positions"`
	DiscoveredTurn int        `json:"discoveredTurn"`
	Mobile         bool       `json:"mobile"`
}

type HeroAction struct {
	Kind      ActionKind `json:"kind"`
	Direction Direction  `json:"direction,omitempty"`
	TargetID  EntityID   `json:"targetId,omitempty"`
	ItemID    EntityID   `json:"itemId,omitempty"`
	SpellKind SpellKind  `json:"spellKind,omitempty"`
}

type LegalAction struct {
	HeroAction
	Description string `json:"description"`
}

// ── Events ──

type EventType string

const (
	EventCombat      EventType = "combat"
	EventMovement    EventType = "movement"
	EventDeath       EventType = "death"
	EventLoot        EventType = "loot"
	EventSpawn       EventType = "spawn"
	EventTrap        EventType = "trap"
	EventInteraction EventType = "interaction"
	EventEffect      EventType = "effect"
	EventQuest       EventType = "quest"
	EventSystem      EventType = "system"
)

type EventRecord struct {
	ID      EntityID  `json:"id"`
	Turn    int       `json:"turn"`
	Type    EventType `json:"type"`
	Summary string    `json:"summary"`
}

// ── Vision ──

type VisionTile struct {
	X    int      `json:"x"`
	Y    int      `json:"y"`
	Kind TileKind `json:"kind"`
}

type VisionData struct {
	Seed             string           `json:"seed"`
	Turn             int              `json:"turn"`
	Hero             *HeroProfile     `json:"hero"`
	VisibleTiles     []VisionTile     `json:"visibleTiles"`
	VisibleMonsters  []Monster        `json:"visibleMonsters"`
	VisibleHeroes    []HeroProfile    `json:"visibleHeroes"`
	VisibleNpcs      []Npc            `json:"visibleNpcs"`
	VisibleItems     []FloorItem      `json:"visibleItems"`
	RecentEvents     []EventRecord    `json:"recentEvents"`
	LegalActions     []LegalAction    `json:"legalActions"`
	SpellDiscoveries []SpellDiscovery `json:"spellDiscoveries,omitempty"`
}

// ── Board state (replaces WorldState) ──

type BoardState struct {
	Seed             string                        `json:"seed"`
	DungeonName      string                        `json:"dungeonName"`
	Turn             int                           `json:"turn"`
	Map              GameMap                       `json:"map"`
	Monsters         []Monster                     `json:"monsters"`
	Heroes           []HeroProfile                 `json:"heroes"`
	Npcs             []Npc                         `json:"npcs"`
	FloorItems       []FloorItem                   `json:"floorItems"`
	Quests           []Quest                       `json:"quests"`
	Events           []EventRecord                 `json:"events"`
	PendingActions   map[EntityID]HeroAction       `json:"pendingActions"`
	SpellDiscoveries map[EntityID][]SpellDiscovery `json:"spellDiscoveries,omitempty"`
}

// ── Scoring ──

type ScoreTrack struct {
	HeroID           EntityID   `json:"heroId"`
	HeroName         string     `json:"heroName"`
	Trait            HeroTrait  `json:"trait"`
	TotalScore       int        `json:"totalScore"`
	CombatScore      int        `json:"combatScore"`
	TreasureScore    int        `json:"treasureScore"`
	ExplorationScore int        `json:"explorationScore"`
	QuestScore       int        `json:"questScore"`
	TurnsSurvived    int        `json:"turnsSurvived"`
	TilesExplored    int        `json:"tilesExplored"`
	MonstersKilled   int        `json:"monstersKilled"`
	Escaped          bool       `json:"escaped"`
	Status           HeroStatus `json:"status"`
}

// ── Turn state ──

type TurnState struct {
	Turn            int       `json:"turn"`
	Phase           TurnPhase `json:"phase"`
	Started         bool      `json:"started"`
	SubmitWindowMs  int64     `json:"submitWindowMs"`
	ResolveWindowMs int64     `json:"resolveWindowMs"`
	PhaseEndsAt     int64     `json:"phaseEndsAt"`
	PhaseDurationMs int64     `json:"phaseDurationMs"`
	PhaseElapsedMs  int64     `json:"phaseElapsedMs"`
	Seed            string    `json:"seed"`
}

// ── Bot messages ──

type BotMessage struct {
	ID        EntityID `json:"id"`
	HeroID    EntityID `json:"heroId"`
	HeroName  string   `json:"heroName"`
	Turn      int      `json:"turn"`
	CreatedAt int64    `json:"createdAt"`
	Message   string   `json:"message"`
}

// ── Board lifecycle ──

type BoardLifecycle string

const (
	LifecycleQueued    BoardLifecycle = "queued"
	LifecycleOpen      BoardLifecycle = "open"
	LifecycleRunning   BoardLifecycle = "running"
	LifecycleCompleted BoardLifecycle = "completed"
)

// ── Lobby info (per-board) ──

type LobbyInfo struct {
	BoardID               string         `json:"boardId"`
	BoardSlug             string         `json:"boardSlug"`
	BoardName             string         `json:"boardName"`
	AttachedHeroes        int            `json:"attachedHeroes"`
	MaxHeroes             int            `json:"maxHeroes"`
	RequiredHeroes        *int           `json:"requiredHeroes"`
	MinHeroesToStart      int            `json:"minHeroesToStart"`
	CanStart              bool           `json:"canStart"`
	CanReset              bool           `json:"canReset"`
	QueueStatus           string         `json:"queueStatus,omitempty"`
	JoinWindowRemainingMs int64          `json:"joinWindowRemainingMs,omitempty"`
	Status                BoardLifecycle `json:"status"`
	Started               bool           `json:"started"`
	CompletionReason      string         `json:"completionReason,omitempty"`
}

// ── Snapshots ──

type BoardSnapshot struct {
	Seed      string `json:"seed"`
	BoardID   string `json:"boardId"`
	BoardSlug string `json:"boardSlug"`
	World     struct {
		DungeonName string `json:"dungeonName"`
		Turn        int    `json:"turn"`
		MapWidth    int    `json:"mapWidth"`
		MapHeight   int    `json:"mapHeight"`
	} `json:"world"`
	Heroes       []HeroProfile `json:"heroes"`
	Leaderboard  []ScoreTrack  `json:"leaderboard"`
	Monsters     []Monster     `json:"monsters"`
	Npcs         []Npc         `json:"npcs"`
	FloorItems   []FloorItem   `json:"floorItems"`
	Map          [][]TileKind  `json:"map"`
	RecentEvents []EventRecord `json:"recentEvents"`
	BotMessages  []BotMessage  `json:"botMessages"`
	TurnState    TurnState     `json:"turnState"`
	Lobby        LobbyInfo     `json:"lobby"`
}

// ── Manager-level snapshot ──

type ManagerSnapshot struct {
	Boards []BoardSummary `json:"boards"`
}

type BoardSummary struct {
	BoardID               string         `json:"boardId"`
	BoardSlug             string         `json:"boardSlug"`
	BoardName             string         `json:"boardName"`
	Status                BoardLifecycle `json:"status"`
	QueueStatus           string         `json:"queueStatus,omitempty"`
	JoinWindowRemainingMs int64          `json:"joinWindowRemainingMs,omitempty"`
	HeroCount             int            `json:"heroCount"`
	MaxHeroes             int            `json:"maxHeroes"`
	Turn                  int            `json:"turn"`
	Seed                  string         `json:"seed"`
	CompletionReason      string         `json:"completionReason,omitempty"`
}

// ── Landmarks ──

type Landmark struct {
	Kind     string   `json:"kind"`
	Name     string   `json:"name"`
	Position Position `json:"position"`
}

// ── Game settings (server-side, fair for all bots) ──

type GameSettings struct {
	Paused          bool `json:"paused"`
	SubmitWindowMs  int  `json:"submitWindowMs,omitempty"`
	ResolveWindowMs int  `json:"resolveWindowMs,omitempty"`
}
