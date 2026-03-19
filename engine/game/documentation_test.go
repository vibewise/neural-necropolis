package game

import (
	"fmt"
	"os"
	"path/filepath"
	"slices"
	"strings"
	"testing"
)

func readMechanicsDoc(t *testing.T) string {
	t.Helper()
	path := filepath.Join("..", "..", "docs", "GAME_MECHANICS.md")
	content, err := os.ReadFile(path)
	if err != nil {
		t.Fatalf("read mechanics doc: %v", err)
	}
	return string(content)
}

func requireDocContainsAll(t *testing.T, doc string, context string, snippets []string) {
	t.Helper()
	for _, snippet := range snippets {
		if !strings.Contains(doc, snippet) {
			t.Fatalf("mechanics doc missing %s snippet %q", context, snippet)
		}
	}
}

func itemStatDocLines(item ItemTemplate) []string {
	if item.StatBonus == nil {
		return nil
	}
	var lines []string
	if item.StatBonus.Attack != 0 {
		lines = append(lines, fmt.Sprintf("- %+d attack", item.StatBonus.Attack))
	}
	if item.StatBonus.Defense != 0 {
		lines = append(lines, fmt.Sprintf("- %+d defense", item.StatBonus.Defense))
	}
	if item.StatBonus.Speed != 0 {
		lines = append(lines, fmt.Sprintf("- %+d speed", item.StatBonus.Speed))
	}
	if item.StatBonus.Perception != 0 {
		lines = append(lines, fmt.Sprintf("- %+d perception", item.StatBonus.Perception))
	}
	if item.StatBonus.MaxHp != 0 {
		lines = append(lines, fmt.Sprintf("- %+d max HP", item.StatBonus.MaxHp))
	}
	return lines
}

func itemKindDocName(kind ItemKind) string {
	return ItemTemplates[kind].Name
}

func merchantStockDocLine() string {
	orderedKinds := make([]ItemKind, 0, len(MerchantStock))
	counts := map[ItemKind]int{}
	for _, kind := range MerchantStock {
		if counts[kind] == 0 {
			orderedKinds = append(orderedKinds, kind)
		}
		counts[kind]++
	}
	parts := make([]string, 0, len(orderedKinds))
	for _, kind := range orderedKinds {
		name := itemKindDocName(kind)
		count := counts[kind]
		if count > 1 {
			switch name {
			case "Health Potion":
				name = "Health Potions"
			default:
				name += "s"
			}
		}
		parts = append(parts, fmt.Sprintf("%d %s", count, name))
	}
	return "- merchant starts with fixed stock: " + strings.Join(parts, ", ")
}

func TestGameMechanicsDocIncludesCoreEngineParameters(t *testing.T) {
	doc := readMechanicsDoc(t)
	expectedSnippets := []string{
		fmt.Sprintf("- map width: %d", CFG.MapWidth),
		fmt.Sprintf("- map height: %d", CFG.MapHeight),
		fmt.Sprintf("- max heroes per board: %d", CFG.MaxBotsPerBoard),
		fmt.Sprintf("- min heroes to auto-start a board: %d", CFG.MinBotsToStart),
		fmt.Sprintf("- max turns per board: %d", CFG.MaxTurnsPerBoard),
		fmt.Sprintf("- hidden trap damage: %d HP", CFG.TrapDamage),
		fmt.Sprintf("- visible trap damage: %d HP", CFG.TrapVisibleDamage),
		fmt.Sprintf("- lava damage: %d HP per step onto lava tile", CFG.LavaDamage),
		fmt.Sprintf("- inventory limit: %d items", CFG.InventoryLimit),
		fmt.Sprintf("- escape bonus: +%d", CFG.EscapeBonus),
		fmt.Sprintf("- treasure tile score: +%d", CFG.TreasureScore),
	}
	requireDocContainsAll(t, doc, "core engine parameter", expectedSnippets)
}

func TestGameMechanicsDocIncludesImplementedActionAndScoringRules(t *testing.T) {
	doc := readMechanicsDoc(t)
	expectedSnippets := []string{
		"- move",
		"- attack",
		"- rest",
		"- use_item",
		"- interact",
		"- wait",
		"- queued",
		"- open",
		"- running",
		"- completed",
		"heroes do not replace queued actions",
		"The leaderboard `TotalScore` is calculated as:",
		"hero score + floor(tiles explored / 10) + floor(turns survived / 5)",
		"Heroes cannot attack other heroes.",
	}
	requireDocContainsAll(t, doc, "implemented rule", expectedSnippets)
	if !strings.Contains(doc, merchantStockDocLine()) {
		t.Fatalf("mechanics doc missing merchant stock line %q", merchantStockDocLine())
	}
	requireDocContainsAll(t, doc, "implemented pool", []string{
		"- ordinary chest loot pool: Health Potion, Rusty Key, Antidote",
		"- rare chest loot pool: Health Potion, Rusty Key, Scroll of Reveal, Iron Sword, Chain Mail, Amulet of Warding",
		"- replacement kind is chosen from goblin, goblin, spider, skeleton",
	})
}

func TestGameMechanicsDocIncludesEveryTraitBonus(t *testing.T) {
	doc := readMechanicsDoc(t)
	testCases := []struct {
		trait    HeroTrait
		heading  string
		snippets []string
	}{
		{trait: TraitAggressive, heading: "Aggressive:", snippets: []string{"- attack +2", "- defense -1"}},
		{trait: TraitCautious, heading: "Cautious:", snippets: []string{"- defense +2", "- max HP +10", "- perception +1"}},
		{trait: TraitGreedy, heading: "Greedy:", snippets: []string{"- perception +1", "- speed +1"}},
		{trait: TraitCurious, heading: "Curious:", snippets: []string{"- perception +2", "- speed +1"}},
		{trait: TraitResilient, heading: "Resilient:", snippets: []string{"- max HP +15", "- defense +1"}},
	}

	for _, tc := range testCases {
		if !strings.Contains(doc, tc.heading) {
			t.Fatalf("mechanics doc missing trait heading %q", tc.heading)
		}
		wantBonus := CFG.TraitBonuses[tc.trait]
		for _, snippet := range tc.snippets {
			if !strings.Contains(doc, snippet) {
				t.Fatalf("mechanics doc missing trait %q snippet %q", tc.trait, snippet)
			}
		}
		if tc.trait == TraitAggressive && (wantBonus.Attack != 2 || wantBonus.Defense != -1) {
			t.Fatalf("unexpected aggressive trait config %+v", wantBonus)
		}
		if tc.trait == TraitCautious && (wantBonus.Defense != 2 || wantBonus.MaxHp != 10 || wantBonus.Perception != 1) {
			t.Fatalf("unexpected cautious trait config %+v", wantBonus)
		}
		if tc.trait == TraitGreedy && (wantBonus.Perception != 1 || wantBonus.Speed != 1) {
			t.Fatalf("unexpected greedy trait config %+v", wantBonus)
		}
		if tc.trait == TraitCurious && (wantBonus.Perception != 2 || wantBonus.Speed != 1) {
			t.Fatalf("unexpected curious trait config %+v", wantBonus)
		}
		if tc.trait == TraitResilient && (wantBonus.MaxHp != 15 || wantBonus.Defense != 1) {
			t.Fatalf("unexpected resilient trait config %+v", wantBonus)
		}
	}

	if !strings.Contains(doc, "- the requested trait is used; if none is supplied, the default trait is curious") {
		t.Fatalf("mechanics doc missing default trait rule")
	}
}

func TestGameMechanicsDocIncludesEveryMonsterTemplate(t *testing.T) {
	doc := readMechanicsDoc(t)
	testCases := []struct {
		kind        MonsterKind
		heading     string
		dropSnippet string
	}{
		{kind: MonGoblin, heading: "Goblin:"},
		{kind: MonSpider, heading: "Spider:", dropSnippet: "- listed drop: Antidote"},
		{kind: MonSkeleton, heading: "Skeleton:", dropSnippet: "- listed drop: Rusty Key"},
		{kind: MonWraith, heading: "Wraith:"},
		{kind: MonOrc, heading: "Orc:", dropSnippet: "- listed drop: Health Potion"},
		{kind: MonMimic, heading: "Mimic:", dropSnippet: "- listed drop: Rusty Key"},
		{kind: MonDragon, heading: "Dragon:", dropSnippet: "- listed drops: Scroll of Reveal, Health Potion"},
	}

	for _, tc := range testCases {
		tmpl := MonsterTemplates[tc.kind]
		snippets := []string{
			tc.heading,
			fmt.Sprintf("- HP %d", tmpl.Hp),
			fmt.Sprintf("- ATK %d", tmpl.Attack),
			fmt.Sprintf("- DEF %d", tmpl.Defense),
			fmt.Sprintf("- SPD %d", tmpl.Speed),
			fmt.Sprintf("- XP reward %d", tmpl.XpReward),
			fmt.Sprintf("- gold drop %d", tmpl.GoldDrop),
			fmt.Sprintf("- behavior %s", tmpl.Behavior),
			fmt.Sprintf("- alert range %d", tmpl.AlertRange),
		}
		if tc.dropSnippet != "" {
			snippets = append(snippets, tc.dropSnippet)
		} else if len(tmpl.Drops) != 0 {
			t.Fatalf("monster %q has undocumented drops configuration %+v", tc.kind, tmpl.Drops)
		}
		requireDocContainsAll(t, doc, fmt.Sprintf("monster %s", tc.kind), snippets)
	}

	if !strings.Contains(doc, "Flee:") {
		t.Fatalf("mechanics doc missing flee behavior section")
	}
}

func TestGameMechanicsDocIncludesEveryItemTemplate(t *testing.T) {
	doc := readMechanicsDoc(t)
	testCases := []struct {
		kind             ItemKind
		additionalChecks []string
	}{
		{kind: ItemHealthPotion, additionalChecks: []string{"- restores 20 HP"}},
		{kind: ItemAntidote, additionalChecks: []string{"- cures poison"}},
		{kind: ItemKey, additionalChecks: []string{"- consumed automatically by locked doors and locked chests"}},
		{kind: ItemScrollReveal, additionalChecks: []string{"- reveals nearby traps"}},
		{kind: ItemScrollTeleport, additionalChecks: []string{"- teleports to a random safe floor tile"}},
		{kind: ItemSword},
		{kind: ItemDagger},
		{kind: ItemAxe},
		{kind: ItemStaff},
		{kind: ItemLeatherArmor},
		{kind: ItemChainArmor},
		{kind: ItemPlateArmor},
		{kind: ItemRingVision},
		{kind: ItemAmuletProtection},
		{kind: ItemBootsSpeed},
	}

	for _, tc := range testCases {
		item := ItemTemplates[tc.kind]
		snippets := []string{item.Name + ":", fmt.Sprintf("- value %d", item.Value)}
		if item.Slot != "" {
			snippets = append(snippets, fmt.Sprintf("- %s", item.Slot))
		}
		snippets = append(snippets, itemStatDocLines(item)...)
		snippets = append(snippets, tc.additionalChecks...)
		requireDocContainsAll(t, doc, fmt.Sprintf("item %s", tc.kind), snippets)
	}

	for _, kind := range EquipmentPool {
		if !strings.Contains(doc, ItemTemplates[kind].Name+":") {
			t.Fatalf("mechanics doc missing equipment pool item heading for %q", kind)
		}
	}
	for _, kind := range RarePool {
		if !strings.Contains(doc, ItemTemplates[kind].Name+":") {
			t.Fatalf("mechanics doc missing rare pool item heading for %q", kind)
		}
	}
	if !slices.Contains(MerchantStock, ItemScrollTeleport) {
		t.Fatalf("merchant stock no longer includes teleport scroll; update docs/tests together")
	}
}
