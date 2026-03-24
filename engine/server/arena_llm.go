package server

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"regexp"
	"sort"
	"strconv"
	"strings"
	"time"

	"github.com/mmorph/engine/game"
)

// ── Provider resolution ──

type providerConfig struct {
	baseURL   string
	apiKeyEnv string
}

var knownProviders = map[string]providerConfig{
	"openai":    {baseURL: "https://api.openai.com/v1", apiKeyEnv: "OPENAI_API_KEY"},
	"groq":      {baseURL: "https://api.groq.com/openai/v1", apiKeyEnv: "GROQ_API_KEY"},
	"together":  {baseURL: "https://api.together.xyz/v1", apiKeyEnv: "TOGETHER_API_KEY"},
	"fireworks": {baseURL: "https://api.fireworks.ai/inference/v1", apiKeyEnv: "FIREWORKS_API_KEY"},
	"mistral":   {baseURL: "https://api.mistral.ai/v1", apiKeyEnv: "MISTRAL_API_KEY"},
	"deepseek":  {baseURL: "https://api.deepseek.com/v1", apiKeyEnv: "DEEPSEEK_API_KEY"},
}

func resolveProvider(provider string) (baseURL string, apiKey string, ok bool) {
	p := strings.ToLower(strings.TrimSpace(provider))

	cfg, known := knownProviders[p]
	if !known {
		cfg = providerConfig{baseURL: "https://api.openai.com/v1", apiKeyEnv: "OPENAI_API_KEY"}
	}

	// Allow env override for base URL: e.g. OPENAI_BASE_URL
	envBaseURL := envOr(strings.ToUpper(p)+"_BASE_URL", "")
	if envBaseURL != "" {
		baseURL = strings.TrimRight(envBaseURL, "/")
	} else {
		baseURL = cfg.baseURL
	}

	apiKey = envOr(cfg.apiKeyEnv, "")
	if apiKey == "" {
		apiKey = envOr("OPENAI_API_KEY", "")
	}
	if apiKey == "" {
		return "", "", false
	}

	return baseURL, apiKey, true
}

// ── OpenAI-compatible chat completion ──

type chatMessage struct {
	Role    string `json:"role"`
	Content string `json:"content"`
}

type chatRequest struct {
	Model               string        `json:"model"`
	Messages            []chatMessage `json:"messages"`
	Temperature         float64       `json:"temperature"`
	MaxCompletionTokens int           `json:"max_completion_tokens,omitempty"`
	ReasoningEffort     string        `json:"reasoning_effort,omitempty"`
}

type chatResponse struct {
	Choices []struct {
		Message struct {
			Content string `json:"content"`
		} `json:"message"`
	} `json:"choices"`
	Usage struct {
		PromptTokens     int `json:"prompt_tokens"`
		CompletionTokens int `json:"completion_tokens"`
		TotalTokens      int `json:"total_tokens"`
	} `json:"usage"`
}

type llmResult struct {
	content          string
	promptTokens     int
	completionTokens int
	totalTokens      int
	trace            *arenaPromptTrace
}

type arenaPromptTrace struct {
	SavedAt                   string   `json:"savedAt,omitempty"`
	ArenaID                   string   `json:"arenaId,omitempty"`
	MatchID                   string   `json:"matchId,omitempty"`
	DuelIndex                 int      `json:"duelIndex,omitempty"`
	PromptNumber              int      `json:"promptNumber"`
	Turn                      int      `json:"turn"`
	BoardID                   string   `json:"boardId"`
	HeroID                    string   `json:"heroId"`
	HeroName                  string   `json:"heroName"`
	BotLabel                  string   `json:"botLabel"`
	Provider                  string   `json:"provider"`
	Model                     string   `json:"model"`
	Strategy                  string   `json:"strategy"`
	PromptStyle               string   `json:"promptStyle"`
	Temperature               float64  `json:"temperature"`
	MaxCompletionTokens       int      `json:"maxCompletionTokens"`
	ReasoningEffort           string   `json:"reasoningEffort,omitempty"`
	LegalActions              []string `json:"legalActions"`
	SystemPrompt              string   `json:"systemPrompt"`
	UserPrompt                string   `json:"userPrompt"`
	RawResponse               string   `json:"rawResponse,omitempty"`
	ProviderError             string   `json:"providerError,omitempty"`
	SelectedActionIndex       *int     `json:"selectedActionIndex,omitempty"`
	SelectedActionDescription string   `json:"selectedActionDescription,omitempty"`
	DecisionSource            string   `json:"decisionSource,omitempty"`
	SubmittedAction           string   `json:"submittedAction,omitempty"`
	QueueAccepted             bool     `json:"queueAccepted"`
	QueueMessage              string   `json:"queueMessage,omitempty"`
	PromptTokens              int      `json:"promptTokens,omitempty"`
	CompletionTokens          int      `json:"completionTokens,omitempty"`
	TotalTokens               int      `json:"totalTokens,omitempty"`
}

var llmHTTPClient = &http.Client{}

func callChatCompletion(ctx context.Context, baseURL, apiKey string, req chatRequest) (*llmResult, error) {
	body, err := json.Marshal(req)
	if err != nil {
		return nil, fmt.Errorf("marshal request: %w", err)
	}

	url := baseURL + "/chat/completions"
	httpReq, err := http.NewRequestWithContext(ctx, http.MethodPost, url, bytes.NewReader(body))
	if err != nil {
		return nil, fmt.Errorf("create request: %w", err)
	}
	httpReq.Header.Set("Content-Type", "application/json")
	httpReq.Header.Set("Authorization", "Bearer "+apiKey)

	resp, err := llmHTTPClient.Do(httpReq)
	if err != nil {
		return nil, fmt.Errorf("http call: %w", err)
	}
	defer resp.Body.Close()

	respBody, err := io.ReadAll(resp.Body)
	if err != nil {
		return nil, fmt.Errorf("read response: %w", err)
	}

	if resp.StatusCode != http.StatusOK {
		truncated := string(respBody)
		if len(truncated) > 300 {
			truncated = truncated[:300] + "..."
		}
		return nil, fmt.Errorf("LLM API %d: %s", resp.StatusCode, truncated)
	}

	var chatResp chatResponse
	if err := json.Unmarshal(respBody, &chatResp); err != nil {
		return nil, fmt.Errorf("unmarshal response: %w", err)
	}

	content := ""
	if len(chatResp.Choices) > 0 {
		content = chatResp.Choices[0].Message.Content
	}

	return &llmResult{
		content:          content,
		promptTokens:     chatResp.Usage.PromptTokens,
		completionTokens: chatResp.Usage.CompletionTokens,
		totalTokens:      chatResp.Usage.TotalTokens,
	}, nil
}

// ── Prompt construction ──

func normalizeArenaPromptStyle(value string) string {
	style := strings.ToLower(strings.TrimSpace(value))
	if style == "naive" {
		return "naive"
	}
	return "smart"
}

func buildArenaSystemPrompt(promptStyle string, strategy string) string {
	base := fmt.Sprintf(`You are a hero in Neural Necropolis, a dungeon crawler. Each turn you choose ONE action from the numbered list of legal actions.

RULES:
- Move to explore the dungeon. Moving into lava or traps causes damage.
- Attack adjacent monsters. Combat uses your ATK vs monster DEF.
- Rest to recover HP and reduce fatigue.
- Use items from inventory (potions heal HP, antidotes cure poison, scrolls have special effects, keys open locked doors/chests).
- Equip weapons, armor, and accessories from inventory to gain stat bonuses (ATK, DEF, SPD, PER, MaxHP). Equipment you walk over auto-equips if the slot is empty.
- Interact with NPCs: shrines heal HP and grant a shield buff, merchants sell items for gold, freeing prisoners completes quests for bonus points.
- Cast spells to reveal map info (locate_treasury, locate_monsters, locate_buildings, locate_prisoner).
- Escape through exit tiles to bank your score safely. Escaping alive grants a bonus.

ITEMS & EQUIPMENT:
- Health Potions restore 20 HP. Use them from inventory when hurt.
- Keys unlock locked doors and locked chests (rare loot inside).
- Weapons add ATK, armor adds DEF, accessories add various stats.
- Check your inventory — if you have unused equipment or consumables, use them!

SCORING: Monster kills, treasure collection, tile exploration, and quest completion earn points. Dying forfeits the escape bonus.

FATIGUE: Increases each turn. At 50+ your stats weaken. Rest or wait to reduce it.
MORALE: Affects combat power. Kills, treasure, and shrines boost it. Damage and poison lower it.

YOUR STRATEGY: %s`, strategy)

	if normalizeArenaPromptStyle(promptStyle) == "smart" {
		base += `

SMART PLAY GUIDELINES:
- Do not repeat the same information-gathering spell over and over when it already returned usable information.
- If an active spell discovery already shows targets, act on it by moving, attacking, interacting, resting, or escaping as appropriate.
- Re-cast a locate spell only when there is a concrete reason, such as stale information, a major position change, or no actionable route.
- Avoid wasting consecutive turns on no-gain utility actions. Break loops.
- Avoid resting when it heals 0 HP unless fatigue is critical and there is no meaningful progress move.
- Prefer progress over narration: explore toward known goals, open doors, collect treasure, fight favorable monsters, and leave when banking score is stronger than gambling.
- If your HP is low or fatigue is high, value survival and recovery over greed.`
	}

	base += `

RESPOND WITH EXACTLY TWO LINES:
ACTION: <number>
REASON: <brief explanation>


<number> must be the 0-based index of your chosen action from the Legal Actions list. Do NOT pick an index outside the list.`

	return base
}

func buildArenaUserPrompt(vision *game.VisionData) string {
	hero := vision.Hero
	var b strings.Builder

	// Core stats
	fmt.Fprintf(&b, "Turn %d | HP: %d/%d | ATK: %d DEF: %d SPD: %d PER: %d\n",
		vision.Turn, hero.Stats.Hp, hero.Stats.MaxHp,
		hero.Stats.Attack, hero.Stats.Defense, hero.Stats.Speed, hero.Stats.Perception)
	fmt.Fprintf(&b, "Score: %d | Gold: %d | Fatigue: %d/100 | Morale: %d/100\n",
		hero.Score, hero.Gold, hero.Fatigue, hero.Morale)
	fmt.Fprintf(&b, "Position: (%d,%d) | Status: %s\n", hero.Position.X, hero.Position.Y, hero.Status)

	// Active effects
	if len(hero.Effects) > 0 {
		parts := make([]string, 0, len(hero.Effects))
		for _, e := range hero.Effects {
			parts = append(parts, fmt.Sprintf("%s(%d turns)", e.Kind, e.TurnsRemaining))
		}
		fmt.Fprintf(&b, "Effects: %s\n", strings.Join(parts, ", "))
	}

	// Equipment
	if hero.Equipment.Weapon != nil || hero.Equipment.Armor != nil || hero.Equipment.Accessory != nil {
		eqParts := make([]string, 0, 3)
		if hero.Equipment.Weapon != nil {
			eqParts = append(eqParts, fmt.Sprintf("Weapon: %s (%s)", hero.Equipment.Weapon.Name, hero.Equipment.Weapon.Description))
		}
		if hero.Equipment.Armor != nil {
			eqParts = append(eqParts, fmt.Sprintf("Armor: %s (%s)", hero.Equipment.Armor.Name, hero.Equipment.Armor.Description))
		}
		if hero.Equipment.Accessory != nil {
			eqParts = append(eqParts, fmt.Sprintf("Acc: %s (%s)", hero.Equipment.Accessory.Name, hero.Equipment.Accessory.Description))
		}
		fmt.Fprintf(&b, "Equipment: %s\n", strings.Join(eqParts, " | "))
	}

	// Inventory
	b.WriteString("\nINVENTORY:\n")
	if len(hero.Inventory) == 0 {
		b.WriteString("  Empty\n")
	} else {
		for _, item := range hero.Inventory {
			if item.Consumable {
				fmt.Fprintf(&b, "  [consumable] %s — %s\n", item.Name, item.Description)
			} else if item.Slot != "" {
				fmt.Fprintf(&b, "  [equippable:%s] %s — %s\n", item.Slot, item.Name, item.Description)
			} else {
				fmt.Fprintf(&b, "  %s — %s\n", item.Name, item.Description)
			}
		}
	}

	// Visible monsters
	b.WriteString("\nVISIBLE MONSTERS:\n")
	if len(vision.VisibleMonsters) == 0 {
		b.WriteString("  None nearby\n")
	} else {
		for _, m := range vision.VisibleMonsters {
			fmt.Fprintf(&b, "  %s at (%d,%d) HP:%d ATK:%d DEF:%d\n",
				m.Name, m.Position.X, m.Position.Y, m.Hp, m.Attack, m.Defense)
		}
	}

	// Visible items
	b.WriteString("\nVISIBLE ITEMS:\n")
	if len(vision.VisibleItems) == 0 {
		b.WriteString("  None nearby\n")
	} else {
		for _, fi := range vision.VisibleItems {
			fmt.Fprintf(&b, "  %s at (%d,%d)\n", fi.Item.Name, fi.Position.X, fi.Position.Y)
		}
	}

	// Visible NPCs
	b.WriteString("\nVISIBLE NPCS:\n")
	if len(vision.VisibleNpcs) == 0 {
		b.WriteString("  None nearby\n")
	} else {
		for _, npc := range vision.VisibleNpcs {
			alreadyUsed := false
			for _, hid := range npc.InteractedBy {
				if hid == hero.ID {
					alreadyUsed = true
					break
				}
			}
			status := ""
			if alreadyUsed {
				status = " (already visited)"
			}
			fmt.Fprintf(&b, "  %s (%s) at (%d,%d)%s\n", npc.Name, npc.Kind, npc.Position.X, npc.Position.Y, status)
		}
	}

	b.WriteString("\nACTIVE SPELL DISCOVERIES:\n")
	if len(vision.SpellDiscoveries) == 0 {
		b.WriteString("  None\n")
	} else {
		for _, discovery := range vision.SpellDiscoveries {
			b.WriteString(formatSpellDiscovery(hero.Position, discovery))
			b.WriteByte('\n')
		}
	}

	// Recent events
	b.WriteString("\nRECENT EVENTS:\n")
	if len(vision.RecentEvents) == 0 {
		b.WriteString("  None\n")
	} else {
		limit := len(vision.RecentEvents)
		if limit > 6 {
			limit = 6
		}
		for _, e := range vision.RecentEvents[:limit] {
			fmt.Fprintf(&b, "  [T%d] %s\n", e.Turn, e.Summary)
		}
	}

	// Legal actions
	b.WriteString("\nLEGAL ACTIONS:\n")
	for i, a := range vision.LegalActions {
		fmt.Fprintf(&b, "  %d: %s\n", i, a.Description)
	}

	return b.String()
}

// ── Response parsing ──

var actionPattern = regexp.MustCompile(`(?i)ACTION\s*:\s*(\d+)`)

func parseActionIndex(text string) (int, bool) {
	matches := actionPattern.FindStringSubmatch(text)
	if len(matches) < 2 {
		return 0, false
	}
	idx, err := strconv.Atoi(matches[1])
	if err != nil {
		return 0, false
	}
	return idx, true
}

// ── High-level arena LLM decision ──

type heroTokenAccum struct {
	botIndex         int
	promptTokens     int
	completionTokens int
	totalTokens      int
	llmCalls         int
	fallbacks        int
}

// chooseArenaActionViaLLM tries to get an action from an LLM provider.
// On success it returns the chosen action, true, and token usage.
// On failure it returns zero action, false — caller should fall back to heuristic.
func chooseArenaActionViaLLM(board *game.Board, heroID string, bot game.ArenaBotConfig, timeout time.Duration) (game.HeroAction, bool, *llmResult) {
	baseURL, apiKey, ok := resolveProvider(bot.Provider)
	if !ok {
		return game.HeroAction{}, false, nil
	}

	vision, err := board.GetVision(heroID)
	if err != nil || vision == nil || vision.Hero == nil {
		return game.HeroAction{}, false, nil
	}
	if vision.Hero.Status != game.StatusAlive {
		return game.HeroAction{}, false, nil
	}
	if len(vision.LegalActions) == 0 {
		return game.HeroAction{Kind: game.ActionWait}, true, nil
	}

	promptStyle := normalizeArenaPromptStyle(bot.PromptStyle)
	temperature := bot.Temperature
	if temperature <= 0 {
		temperature = 0.7
	}
	maxTokens := bot.MaxOutputTokens
	if maxTokens <= 0 {
		maxTokens = 180
	}
	systemPrompt := buildArenaSystemPrompt(promptStyle, bot.Strategy)
	userPrompt := buildArenaUserPrompt(vision)
	legalActions := make([]string, 0, len(vision.LegalActions))
	for _, action := range vision.LegalActions {
		legalActions = append(legalActions, action.Description)
	}
	trace := &arenaPromptTrace{
		PromptNumber:        vision.Turn,
		Turn:                vision.Turn,
		BoardID:             board.ID,
		HeroID:              heroID,
		HeroName:            vision.Hero.Name,
		BotLabel:            bot.Label,
		Provider:            bot.Provider,
		Model:               bot.Model,
		Strategy:            bot.Strategy,
		PromptStyle:         promptStyle,
		Temperature:         temperature,
		MaxCompletionTokens: maxTokens,
		ReasoningEffort:     bot.ReasoningEffort,
		LegalActions:        legalActions,
		SystemPrompt:        systemPrompt,
		UserPrompt:          userPrompt,
	}

	req := chatRequest{
		Model: bot.Model,
		Messages: []chatMessage{
			{Role: "system", Content: systemPrompt},
			{Role: "user", Content: userPrompt},
		},
		Temperature:         temperature,
		MaxCompletionTokens: maxTokens,
	}
	if bot.ReasoningEffort != "" {
		req.ReasoningEffort = bot.ReasoningEffort
	}

	ctx, cancel := context.WithTimeout(context.Background(), timeout)
	defer cancel()

	result, err := callChatCompletion(ctx, baseURL, apiKey, req)
	if err != nil {
		trace.ProviderError = err.Error()
		return game.HeroAction{}, false, &llmResult{trace: trace}
	}
	result.trace = trace
	result.trace.RawResponse = result.content
	result.trace.PromptTokens = result.promptTokens
	result.trace.CompletionTokens = result.completionTokens
	result.trace.TotalTokens = result.totalTokens

	idx, parsed := parseActionIndex(result.content)
	if !parsed || idx < 0 || idx >= len(vision.LegalActions) {
		return game.HeroAction{}, false, result
	}
	result.trace.SelectedActionIndex = &idx
	result.trace.SelectedActionDescription = vision.LegalActions[idx].Description

	return vision.LegalActions[idx].HeroAction, true, result
}

func formatSpellDiscovery(heroPos game.Position, discovery game.SpellDiscovery) string {
	positions := append([]game.Position(nil), discovery.Positions...)
	sort.Slice(positions, func(i, j int) bool {
		left := game.Manhattan(heroPos, positions[i])
		right := game.Manhattan(heroPos, positions[j])
		if left != right {
			return left < right
		}
		if positions[i].Y != positions[j].Y {
			return positions[i].Y < positions[j].Y
		}
		return positions[i].X < positions[j].X
	})

	parts := make([]string, 0, min(len(positions), 6))
	limit := min(len(positions), 6)
	for i := 0; i < limit; i++ {
		pos := positions[i]
		parts = append(parts, fmt.Sprintf("(%d,%d) d=%d", pos.X, pos.Y, game.Manhattan(heroPos, pos)))
	}

	line := fmt.Sprintf("  %s discovered on turn %d: %d positions", discovery.Spell, discovery.DiscoveredTurn, len(discovery.Positions))
	if len(parts) > 0 {
		line += " -> " + strings.Join(parts, ", ")
	}
	if len(discovery.Positions) > limit {
		line += fmt.Sprintf(", +%d more", len(discovery.Positions)-limit)
	}
	return line
}
