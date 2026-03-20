package game

// CONFIG mirrors the TypeScript CONFIG object with all balance constants.
var CFG = struct {
	MapWidth   int
	MapHeight  int
	RoomCount  int
	VisionBase int

	HeroBaseStats HeroStats

	TraitBonuses map[HeroTrait]StatBonus

	FatiguePerTurn       int
	FatigueCombatExtra   int
	FatigueWaterExtra    int
	FatigueRestReduction int
	FatigueWaitReduction int
	FatiguePenalty50     int
	FatiguePenalty75     int
	FatiguePenalty100    int
	FatigueMax           int

	MoraleStart     int
	MoraleKill      int
	MoraleTreasure  int
	MoraleQuest     int
	MoraleShrine    int
	MoraleDamage    int
	MoraleAllyDeath int
	MoralePoison    int
	MoraleHigh      int
	MoraleHighAtk   int
	MoraleLow       int
	MoraleLowAtk    int
	MoraleLowDef    int
	MoraleMax       int
	MoraleMin       int

	RestHeal                int
	PotionHeal              int
	TrapDamage              int
	TrapVisibleDamage       int
	LavaDamage              int
	InventoryLimit          int
	EscapeBonus             int
	TreasureScore           int
	ExploreScoreDivisor     int
	SurvivalScoreDivisor    int
	ShrineHeal              int
	MonsterSpawnMin         int
	MonsterSpawnChance      float64
	MaxEvents               int
	PerceptionTrapThreshold int
	ScrollRevealRadius      int

	MaxBotsPerBoard    int
	MinBotsToStart     int
	MinBotsAfterWait   int
	BoardJoinWindowMs  int
	PreparedBoardQueue int
	MaxTurnsPerBoard   int
}{
	MapWidth:   48,
	MapHeight:  32,
	RoomCount:  9,
	VisionBase: 3,

	HeroBaseStats: HeroStats{MaxHp: 40, Hp: 40, Attack: 5, Defense: 3, Speed: 3, Perception: 5},

	TraitBonuses: map[HeroTrait]StatBonus{
		TraitAggressive: {Attack: 2, Defense: -1},
		TraitCautious:   {Defense: 2, MaxHp: 10, Perception: 1},
		TraitGreedy:     {Perception: 1, Speed: 1},
		TraitCurious:    {Perception: 2, Speed: 1},
		TraitResilient:  {MaxHp: 15, Defense: 1},
	},

	FatiguePerTurn:       1,
	FatigueCombatExtra:   1,
	FatigueWaterExtra:    2,
	FatigueRestReduction: 8,
	FatigueWaitReduction: 2,
	FatiguePenalty50:     1,
	FatiguePenalty75:     2,
	FatiguePenalty100:    3,
	FatigueMax:           100,

	MoraleStart:     50,
	MoraleKill:      5,
	MoraleTreasure:  3,
	MoraleQuest:     10,
	MoraleShrine:    10,
	MoraleDamage:    -2,
	MoraleAllyDeath: -5,
	MoralePoison:    -3,
	MoraleHigh:      70,
	MoraleHighAtk:   1,
	MoraleLow:       30,
	MoraleLowAtk:    -1,
	MoraleLowDef:    -1,
	MoraleMax:       100,
	MoraleMin:       0,

	RestHeal:                5,
	PotionHeal:              20,
	TrapDamage:              8,
	TrapVisibleDamage:       4,
	LavaDamage:              10,
	InventoryLimit:          8,
	EscapeBonus:             50,
	TreasureScore:           10,
	ExploreScoreDivisor:     10,
	SurvivalScoreDivisor:    5,
	ShrineHeal:              15,
	MonsterSpawnMin:         4,
	MonsterSpawnChance:      0.5,
	MaxEvents:               80,
	PerceptionTrapThreshold: 7,
	ScrollRevealRadius:      6,

	MaxBotsPerBoard:    4,
	MinBotsToStart:     4,
	MinBotsAfterWait:   1,
	BoardJoinWindowMs:  10000,
	PreparedBoardQueue: 10,
	MaxTurnsPerBoard:   20,
}
