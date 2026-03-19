package game

import "fmt"

// ── Room types ──

type RoomType string

const (
	RoomSpawn         RoomType = "spawn"
	RoomNormal        RoomType = "normal"
	RoomTreasureVault RoomType = "treasure_vault"
	RoomShrineRoom    RoomType = "shrine_room"
	RoomMerchantRoom  RoomType = "merchant_room"
	RoomPrison        RoomType = "prison"
	RoomBossLair      RoomType = "boss_lair"
)

type Room struct {
	X, Y, W, H int
	Type       RoomType
}

func roomCenter(r Room) Position {
	return Position{r.X + r.W/2, r.Y + r.H/2}
}

func roomsOverlap(a, b Room) bool {
	pad := 2
	return a.X-pad < b.X+b.W+pad &&
		a.X+a.W+pad > b.X-pad &&
		a.Y-pad < b.Y+b.H+pad &&
		a.Y+a.H+pad > b.Y-pad
}

// ── Corridor carving ──

func carveCorridor(tiles [][]TileKind, from, to Position, corridorSet map[string]bool, rng *Rng) {
	x, y := from.X, from.Y
	horizontal := rng.Chance(0.5)

	if horizontal {
		for x != to.X {
			if tiles[y][x] == TileWall {
				tiles[y][x] = TileFloor
				corridorSet[fmt.Sprintf("%d,%d", x, y)] = true
			}
			if x < to.X {
				x++
			} else {
				x--
			}
		}
		for y != to.Y {
			if tiles[y][x] == TileWall {
				tiles[y][x] = TileFloor
				corridorSet[fmt.Sprintf("%d,%d", x, y)] = true
			}
			if y < to.Y {
				y++
			} else {
				y--
			}
		}
	} else {
		for y != to.Y {
			if tiles[y][x] == TileWall {
				tiles[y][x] = TileFloor
				corridorSet[fmt.Sprintf("%d,%d", x, y)] = true
			}
			if y < to.Y {
				y++
			} else {
				y--
			}
		}
		for x != to.X {
			if tiles[y][x] == TileWall {
				tiles[y][x] = TileFloor
				corridorSet[fmt.Sprintf("%d,%d", x, y)] = true
			}
			if x < to.X {
				x++
			} else {
				x--
			}
		}
	}
	if tiles[to.Y][to.X] == TileWall {
		tiles[to.Y][to.X] = TileFloor
	}
}

// ── Door placement ──

func placeDoors(tiles [][]TileKind, rooms []Room, rng *Rng) {
	H := len(tiles)
	W := len(tiles[0])
	dirs := [][2]int{{0, -1}, {0, 1}, {-1, 0}, {1, 0}}

	for _, room := range rooms {
		for y := room.Y; y < room.Y+room.H; y++ {
			for x := room.X; x < room.X+room.W; x++ {
				// Only edges
				if y != room.Y && y != room.Y+room.H-1 && x != room.X && x != room.X+room.W-1 {
					continue
				}
				if tiles[y][x] != TileFloor {
					continue
				}
				for _, d := range dirs {
					nx, ny := x+d[0], y+d[1]
					if nx < 0 || nx >= W || ny < 0 || ny >= H {
						continue
					}
					if tiles[ny][nx] != TileFloor {
						continue
					}
					outside := nx < room.X || nx >= room.X+room.W || ny < room.Y || ny >= room.Y+room.H
					if !outside {
						continue
					}
					if rng.Chance(0.4) {
						if room.Type == RoomBossLair || room.Type == RoomTreasureVault {
							if rng.Chance(0.5) {
								tiles[y][x] = TileDoorLocked
							} else {
								tiles[y][x] = TileDoorClosed
							}
						} else {
							tiles[y][x] = TileDoorClosed
						}
					}
					break
				}
			}
		}
	}
}

// ── Trap placement ──

func placeTraps(tiles [][]TileKind, corridorSet map[string]bool, rng *Rng) {
	for key := range corridorSet {
		if rng.Chance(0.08) {
			var sx, sy int
			fmt.Sscanf(key, "%d,%d", &sx, &sy)
			if tiles[sy][sx] == TileFloor {
				tiles[sy][sx] = TileTrapHidden
			}
		}
	}
}

// ── Place tiles in rooms ──

func placeInRoom(tiles [][]TileKind, room Room, kind TileKind, count int, rng *Rng, used map[string]bool) {
	placed := 0
	attempts := 0
	for placed < count && attempts < 100 {
		x := rng.Int(room.X+1, room.X+room.W-2)
		y := rng.Int(room.Y+1, room.Y+room.H-2)
		key := fmt.Sprintf("%d,%d", x, y)
		if tiles[y][x] == TileFloor && !used[key] {
			tiles[y][x] = kind
			used[key] = true
			placed++
		}
		attempts++
	}
}

// ── Monster spawning ──

func spawnMonsters(rooms []Room, tiles [][]TileKind, rng *Rng, used map[string]bool) []Monster {
	var monsters []Monster

	for _, room := range rooms {
		if room.Type == RoomSpawn || room.Type == RoomShrineRoom || room.Type == RoomMerchantRoom {
			continue
		}

		var kinds []MonsterKind
		var count int

		switch room.Type {
		case RoomBossLair:
			kinds = []MonsterKind{MonDragon}
			count = 1
		case RoomTreasureVault:
			kinds = []MonsterKind{MonOrc, MonSkeleton, MonMimic}
			count = rng.Int(2, 3)
		case RoomPrison:
			kinds = []MonsterKind{MonSkeleton, MonOrc}
			count = rng.Int(1, 2)
		default:
			kinds = []MonsterKind{MonGoblin, MonGoblin, MonSpider, MonSkeleton}
			count = rng.Int(1, 3)
		}

		for m := 0; m < count; m++ {
			kind := rng.PickMonsterKind(kinds)
			tmpl := MonsterTemplates[kind]
			names := MonsterNames[kind]

			var pos *Position
			for a := 0; a < 40; a++ {
				x := rng.Int(room.X+1, room.X+room.W-2)
				y := rng.Int(room.Y+1, room.Y+room.H-2)
				key := fmt.Sprintf("%d,%d", x, y)
				if tiles[y][x] == TileFloor && !used[key] {
					pos = &Position{x, y}
					used[key] = true
					break
				}
			}
			if pos == nil {
				continue
			}

			drops := make([]ItemKind, len(tmpl.Drops))
			copy(drops, tmpl.Drops)

			monsterID := NewID()
			monsterName := rng.Pick(names)
			monsters = append(monsters, Monster{
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
				Position:   *pos,
				Effects:    []StatusEffect{},
				Drops:      drops,
				AlertRange: tmpl.AlertRange,
			})
		}
	}
	return monsters
}

// ── NPC spawning ──

func spawnNpcs(rooms []Room, rng *Rng, used map[string]bool) []Npc {
	var npcs []Npc

	for _, room := range rooms {
		switch room.Type {
		case RoomShrineRoom:
			c := roomCenter(room)
			npcs = append(npcs, Npc{
				ID:           NewID(),
				Kind:         NpcShrine,
				Name:         rng.Pick(NpcNames[NpcShrine]),
				Position:     c,
				InteractedBy: []EntityID{},
			})
			used[fmt.Sprintf("%d,%d", c.X, c.Y)] = true

		case RoomMerchantRoom:
			c := roomCenter(room)
			var stock []Item
			for _, k := range MerchantStock {
				stock = append(stock, MakeItem(k))
			}
			npcs = append(npcs, Npc{
				ID:           NewID(),
				Kind:         NpcMerchant,
				Name:         rng.Pick(NpcNames[NpcMerchant]),
				Position:     c,
				Inventory:    stock,
				InteractedBy: []EntityID{},
			})
			used[fmt.Sprintf("%d,%d", c.X, c.Y)] = true

		case RoomPrison:
			c := roomCenter(room)
			npcs = append(npcs, Npc{
				ID:           NewID(),
				Kind:         NpcPrisoner,
				Name:         rng.Pick(NpcNames[NpcPrisoner]),
				Position:     c,
				InteractedBy: []EntityID{},
			})
			used[fmt.Sprintf("%d,%d", c.X, c.Y)] = true
		}
	}
	return npcs
}

// ── Floor item spawning ──

func spawnFloorItems(rooms []Room, tiles [][]TileKind, rng *Rng, used map[string]bool) []FloorItem {
	var items []FloorItem

	for _, room := range rooms {
		if room.Type == RoomSpawn {
			continue
		}

		switch room.Type {
		case RoomTreasureVault:
			for i := 0; i < rng.Int(2, 3); i++ {
				kind := rng.PickItemKind(EquipmentPool)
				pos := findFloorInRoom(room, tiles, rng, used)
				if pos != nil {
					items = append(items, FloorItem{ID: NewID(), Item: MakeItem(kind), Position: *pos})
				}
			}
		case RoomBossLair:
			kind := rng.PickItemKind(RarePool)
			pos := findFloorInRoom(room, tiles, rng, used)
			if pos != nil {
				items = append(items, FloorItem{ID: NewID(), Item: MakeItem(kind), Position: *pos})
			}
		case RoomNormal:
			if rng.Chance(0.35) {
				pool := append([]ItemKind{}, EquipmentPool...)
				pool = append(pool, ItemHealthPotion, ItemKey)
				kind := rng.PickItemKind(pool)
				pos := findFloorInRoom(room, tiles, rng, used)
				if pos != nil {
					items = append(items, FloorItem{ID: NewID(), Item: MakeItem(kind), Position: *pos})
				}
			}
		}
	}
	return items
}

func findFloorInRoom(room Room, tiles [][]TileKind, rng *Rng, used map[string]bool) *Position {
	for a := 0; a < 40; a++ {
		x := rng.Int(room.X+1, room.X+room.W-2)
		y := rng.Int(room.Y+1, room.Y+room.H-2)
		key := fmt.Sprintf("%d,%d", x, y)
		if tiles[y][x] == TileFloor && !used[key] {
			used[key] = true
			return &Position{x, y}
		}
	}
	return nil
}

// ── Main generation ──

func GenerateDungeon(seed string) *BoardState {
	rng := NewRng(seed)
	W := CFG.MapWidth
	H := CFG.MapHeight

	tiles := make([][]TileKind, H)
	for y := 0; y < H; y++ {
		tiles[y] = make([]TileKind, W)
		for x := 0; x < W; x++ {
			tiles[y][x] = TileWall
		}
	}

	// Generate rooms
	var rooms []Room
	attempts := 0
	for len(rooms) < CFG.RoomCount && attempts < 600 {
		w := rng.Int(5, 9)
		h := rng.Int(5, 7)
		x := rng.Int(1, W-w-1)
		y := rng.Int(1, H-h-1)
		candidate := Room{x, y, w, h, RoomNormal}
		overlap := false
		for _, r := range rooms {
			if roomsOverlap(r, candidate) {
				overlap = true
				break
			}
		}
		if !overlap {
			rooms = append(rooms, candidate)
		}
		attempts++
	}

	if len(rooms) < 3 {
		rooms = append(rooms,
			Room{2, 2, 6, 5, RoomNormal},
			Room{20, 10, 6, 5, RoomNormal},
			Room{38, 22, 7, 6, RoomNormal},
		)
	}

	// Assign room types
	rooms[0].Type = RoomSpawn
	rooms[len(rooms)-1].Type = RoomBossLair
	if len(rooms) > 3 {
		rooms[len(rooms)-2].Type = RoomTreasureVault
	}

	// Shuffle normals for special room assignment
	var normalIndices []string
	for i, r := range rooms {
		if r.Type == RoomNormal {
			normalIndices = append(normalIndices, fmt.Sprintf("%d", i))
		}
	}
	shuffled := rng.Shuffle(normalIndices)
	if len(shuffled) > 0 {
		var idx int
		fmt.Sscanf(shuffled[0], "%d", &idx)
		rooms[idx].Type = RoomShrineRoom
	}
	if len(shuffled) > 1 {
		var idx int
		fmt.Sscanf(shuffled[1], "%d", &idx)
		rooms[idx].Type = RoomMerchantRoom
	}
	if len(shuffled) > 2 {
		var idx int
		fmt.Sscanf(shuffled[2], "%d", &idx)
		rooms[idx].Type = RoomPrison
	}

	// Carve rooms
	for _, room := range rooms {
		for y := room.Y; y < room.Y+room.H; y++ {
			for x := room.X; x < room.X+room.W; x++ {
				tiles[y][x] = TileFloor
			}
		}
	}

	// Connect rooms with corridors
	corridorSet := make(map[string]bool)
	for i := 0; i < len(rooms)-1; i++ {
		carveCorridor(tiles, roomCenter(rooms[i]), roomCenter(rooms[i+1]), corridorSet, rng)
	}
	// Extra connectivity
	if len(rooms) > 5 {
		carveCorridor(tiles, roomCenter(rooms[0]), roomCenter(rooms[len(rooms)/2]), corridorSet, rng)
	}

	// Doors, traps
	placeDoors(tiles, rooms, rng)
	placeTraps(tiles, corridorSet, rng)

	// Used-position tracker
	used := make(map[string]bool)

	// Treasure & potion tiles in rooms
	for _, room := range rooms {
		switch room.Type {
		case RoomTreasureVault:
			placeInRoom(tiles, room, TileTreasure, rng.Int(3, 5), rng, used)
			placeInRoom(tiles, room, TileChest, rng.Int(1, 2), rng, used)
			placeInRoom(tiles, room, TileChestLocked, rng.Int(0, 1), rng, used)
		case RoomBossLair:
			placeInRoom(tiles, room, TileTreasure, rng.Int(1, 2), rng, used)
			placeInRoom(tiles, room, TileChestLocked, 1, rng, used)
		case RoomSpawn, RoomShrineRoom, RoomMerchantRoom:
			// nothing
		default:
			if rng.Chance(0.5) {
				placeInRoom(tiles, room, TileTreasure, rng.Int(1, 2), rng, used)
			}
			if rng.Chance(0.4) {
				placeInRoom(tiles, room, TilePotion, 1, rng, used)
			}
		}
	}

	// Scatter a few potions in corridors
	potionsPlaced := 0
	for key := range corridorSet {
		if potionsPlaced >= 3 {
			break
		}
		if rng.Chance(0.03) {
			var sx, sy int
			fmt.Sscanf(key, "%d,%d", &sx, &sy)
			if tiles[sy][sx] == TileFloor {
				tiles[sy][sx] = TilePotion
				potionsPlaced++
			}
		}
	}

	// Lava/water in some rooms
	for _, room := range rooms {
		if room.Type == RoomNormal && rng.Chance(0.2) {
			placeInRoom(tiles, room, TileShallowWater, rng.Int(2, 4), rng, used)
		}
		if room.Type == RoomBossLair && rng.Chance(0.4) {
			placeInRoom(tiles, room, TileLava, rng.Int(2, 3), rng, used)
		}
	}

	// Exit tile in boss room
	bossRoom := rooms[len(rooms)-1]
	exitPos := roomCenter(bossRoom)
	if tiles[exitPos.Y][exitPos.X] != TileFloor {
		exitPos.X = bossRoom.X + 1
		exitPos.Y = bossRoom.Y + 1
	}
	tiles[exitPos.Y][exitPos.X] = TileExit
	used[fmt.Sprintf("%d,%d", exitPos.X, exitPos.Y)] = true

	// Spawn entities
	monsters := spawnMonsters(rooms, tiles, rng, used)
	npcs := spawnNpcs(rooms, rng, used)
	floorItems := spawnFloorItems(rooms, tiles, rng, used)

	return &BoardState{
		Seed:           seed,
		DungeonName:    rng.Pick(DungeonNames),
		Turn:           1,
		Map:            GameMap{Width: W, Height: H, Tiles: tiles},
		Monsters:       monsters,
		Heroes:         []HeroProfile{},
		Npcs:           npcs,
		FloorItems:     floorItems,
		Quests:         []Quest{},
		Events:         []EventRecord{},
		PendingActions: make(map[EntityID]HeroAction),
	}
}

// GetSpawnPosition finds a floor tile with many floor neighbors (open area).
func GetSpawnPosition(state *BoardState) Position {
	tiles := state.Map.Tiles
	for y := 1; y < state.Map.Height-1; y++ {
		for x := 1; x < state.Map.Width-1; x++ {
			if tiles[y][x] != TileFloor {
				continue
			}
			neighbors := 0
			for dy := -1; dy <= 1; dy++ {
				for dx := -1; dx <= 1; dx++ {
					ny, nx := y+dy, x+dx
					if ny >= 0 && ny < state.Map.Height && nx >= 0 && nx < state.Map.Width && tiles[ny][nx] != TileWall {
						neighbors++
					}
				}
			}
			if neighbors >= 7 {
				return Position{x, y}
			}
		}
	}
	return Position{2, 2}
}
