package game

// ── Monster templates ──

type MonsterTemplate struct {
	Kind       MonsterKind
	Hp         int
	Attack     int
	Defense    int
	Speed      int
	XpReward   int
	GoldDrop   int
	Behavior   MonsterBehavior
	Drops      []ItemKind
	AlertRange int
}

var MonsterTemplates = map[MonsterKind]MonsterTemplate{
	MonGoblin:   {MonGoblin, 8, 3, 1, 3, 5, 3, BehaviorPatrol, nil, 5},
	MonSpider:   {MonSpider, 6, 4, 0, 4, 4, 2, BehaviorAmbush, []ItemKind{ItemAntidote}, 3},
	MonSkeleton: {MonSkeleton, 12, 4, 2, 2, 8, 6, BehaviorGuard, []ItemKind{ItemKey}, 5},
	MonWraith:   {MonWraith, 15, 6, 1, 4, 12, 8, BehaviorChase, nil, 7},
	MonOrc:      {MonOrc, 20, 6, 3, 2, 15, 12, BehaviorGuard, []ItemKind{ItemHealthPotion}, 5},
	MonMimic:    {MonMimic, 18, 7, 4, 1, 20, 20, BehaviorAmbush, []ItemKind{ItemKey}, 2},
	MonDragon:   {MonDragon, 50, 10, 5, 3, 40, 30, BehaviorGuard, []ItemKind{ItemScrollReveal, ItemHealthPotion}, 6},
}

var MonsterNames = map[MonsterKind][]string{
	MonGoblin:   {"Snark", "Grik", "Blix", "Nub", "Fang", "Rot"},
	MonSpider:   {"Skitter", "Weaver", "Fangspinner", "Webmaw", "Lurk"},
	MonSkeleton: {"Rattles", "Boneclaw", "Dustwalker", "Hollowgrin", "Ashbone"},
	MonWraith:   {"Whisper", "Dreadshade", "Gloom", "Phantasm", "Void"},
	MonOrc:      {"Grom", "Thrak", "Brug", "Skull-Splitter", "Ironjaw"},
	MonMimic:    {"Deceiver", "Greedmaw", "Trapjaw", "False-Hope"},
	MonDragon:   {"Scorchfang", "Emberclaw", "Ashwing", "Doomscale"},
}

// ── Item templates ──

type ItemTemplate struct {
	Kind        ItemKind
	Name        string
	Slot        ItemSlot
	StatBonus   *StatBonus
	Value       int
	Consumable  bool
	Description string
}

var ItemTemplates = map[ItemKind]ItemTemplate{
	ItemHealthPotion:     {ItemHealthPotion, "Health Potion", "", nil, 10, true, "Restores 20 HP"},
	ItemAntidote:         {ItemAntidote, "Antidote", "", nil, 8, true, "Cures poison"},
	ItemKey:              {ItemKey, "Rusty Key", "", nil, 5, true, "Opens a locked door or chest"},
	ItemScrollReveal:     {ItemScrollReveal, "Scroll of Reveal", "", nil, 15, true, "Reveals traps nearby"},
	ItemScrollTeleport:   {ItemScrollTeleport, "Scroll of Teleport", "", nil, 20, true, "Teleport to a random safe tile"},
	ItemSword:            {ItemSword, "Iron Sword", SlotWeapon, &StatBonus{Attack: 3}, 25, false, "+3 ATK"},
	ItemDagger:           {ItemDagger, "Shadow Dagger", SlotWeapon, &StatBonus{Attack: 2, Speed: 1}, 20, false, "+2 ATK, +1 SPD"},
	ItemAxe:              {ItemAxe, "Battle Axe", SlotWeapon, &StatBonus{Attack: 5, Speed: -1}, 30, false, "+5 ATK, -1 SPD"},
	ItemStaff:            {ItemStaff, "Seer's Staff", SlotWeapon, &StatBonus{Attack: 1, Perception: 3}, 22, false, "+1 ATK, +3 PER"},
	ItemLeatherArmor:     {ItemLeatherArmor, "Leather Armor", SlotArmor, &StatBonus{Defense: 2}, 20, false, "+2 DEF"},
	ItemChainArmor:       {ItemChainArmor, "Chain Mail", SlotArmor, &StatBonus{Defense: 4, Speed: -1}, 35, false, "+4 DEF, -1 SPD"},
	ItemPlateArmor:       {ItemPlateArmor, "Plate Armor", SlotArmor, &StatBonus{Defense: 6, Speed: -2}, 50, false, "+6 DEF, -2 SPD"},
	ItemRingVision:       {ItemRingVision, "Ring of Far Sight", SlotAccessory, &StatBonus{Perception: 4}, 30, false, "+4 PER"},
	ItemAmuletProtection: {ItemAmuletProtection, "Amulet of Warding", SlotAccessory, &StatBonus{Defense: 2, MaxHp: 10}, 30, false, "+2 DEF, +10 maxHP"},
	ItemBootsSpeed:       {ItemBootsSpeed, "Boots of Haste", SlotAccessory, &StatBonus{Speed: 3}, 28, false, "+3 SPD"},
}

// ── NPC names ──

var NpcNames = map[NpcKind][]string{
	NpcMerchant: {"Grynn the Peddler", "Old Sacks", "Darkmarket Dez", "Fungal Finn"},
	NpcShrine:   {"Moonwell", "Altar of Light", "Emberstone Shrine", "Spirit Fountain"},
	NpcPrisoner: {"Sir Aldric", "Wren the Scout", "Elder Mira", "Pip the Thief"},
}

// ── Dungeon names ──

var DungeonNames = []string{
	"Shadowkeep", "The Bone Pits", "Cryptfang Halls", "Embervault",
	"The Hollow", "Dreadmaze", "Fungal Depths", "Iron Tomb",
	"Whisperdeep", "The Sunken Vaults",
}

// ── Loot pools ──

var MerchantStock = []ItemKind{
	ItemHealthPotion, ItemHealthPotion, ItemAntidote, ItemKey, ItemScrollReveal, ItemScrollTeleport,
}

var EquipmentPool = []ItemKind{
	ItemSword, ItemDagger, ItemAxe, ItemStaff,
	ItemLeatherArmor, ItemChainArmor,
	ItemRingVision, ItemBootsSpeed,
}

var RarePool = []ItemKind{
	ItemPlateArmor, ItemAmuletProtection, ItemAxe, ItemChainArmor,
}

// MakeItem creates an Item instance from a template.
func MakeItem(kind ItemKind) Item {
	t := ItemTemplates[kind]
	return Item{
		ID:          NewID(),
		Kind:        t.Kind,
		Name:        t.Name,
		Slot:        t.Slot,
		StatBonus:   t.StatBonus,
		Value:       t.Value,
		Consumable:  t.Consumable,
		Description: t.Description,
	}
}
