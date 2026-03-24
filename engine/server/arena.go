package server

import (
	"encoding/json"
	"fmt"
	"net/http"
	"sort"
	"strings"
	"sync"
	"time"

	"github.com/mmorph/engine/game"
)

// ── Arena route handler ──

func (s *Server) handleArenaRoutes(w http.ResponseWriter, r *http.Request) {
	requestID := randomToken(8)

	// Strip the /api/arena prefix
	path := strings.TrimPrefix(r.URL.Path, "/api/arena")

	// /api/arena → list or create
	if path == "" || path == "/" {
		switch r.Method {
		case http.MethodGet:
			s.handleListArenas(w)
		case http.MethodPost:
			if !s.requireAdminAuth(w, r, requestID) {
				return
			}
			s.handleCreateArena(w, r)
		default:
			w.WriteHeader(http.StatusMethodNotAllowed)
		}
		return
	}

	// /api/arena/{arenaId}/...
	parts := strings.SplitN(strings.TrimPrefix(path, "/"), "/", 3)
	arenaID := parts[0]

	if len(parts) == 1 {
		if r.Method == http.MethodGet {
			s.handleGetArena(w, arenaID)
			return
		}
		w.WriteHeader(http.StatusMethodNotAllowed)
		return
	}

	switch parts[1] {
	case "matches":
		if r.Method == http.MethodPost {
			if !s.requireAdminAuth(w, r, requestID) {
				return
			}
			s.handleAddMatch(w, r, arenaID)
			return
		}
		w.WriteHeader(http.StatusMethodNotAllowed)
	case "start":
		if r.Method == http.MethodPost {
			if !s.requireAdminAuth(w, r, requestID) {
				return
			}
			s.handleStartArena(w, arenaID)
			return
		}
		w.WriteHeader(http.StatusMethodNotAllowed)
	default:
		http.NotFound(w, r)
	}
}

func (s *Server) handleListArenas(w http.ResponseWriter) {
	writeJSON(w, map[string]interface{}{
		"arenas": s.arenas.ListArenas(),
	})
}

func (s *Server) handleGetArena(w http.ResponseWriter, arenaID string) {
	arena := s.arenas.GetArena(arenaID)
	if arena == nil {
		w.WriteHeader(http.StatusNotFound)
		writeJSON(w, map[string]interface{}{"error": "arena not found"})
		return
	}
	writeJSON(w, arena.Snapshot())
}

func (s *Server) handleCreateArena(w http.ResponseWriter, r *http.Request) {
	var req game.CreateArenaRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		w.WriteHeader(http.StatusBadRequest)
		writeJSON(w, map[string]interface{}{"error": "invalid request body"})
		return
	}

	arena, err := s.arenas.CreateArena(req)
	if err != nil {
		w.WriteHeader(http.StatusBadRequest)
		writeJSON(w, map[string]interface{}{"error": err.Error()})
		return
	}

	writeJSON(w, arena.Snapshot())
}

func (s *Server) handleAddMatch(w http.ResponseWriter, r *http.Request, arenaID string) {
	var req game.AddMatchRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		w.WriteHeader(http.StatusBadRequest)
		writeJSON(w, map[string]interface{}{"error": "invalid request body"})
		return
	}

	match, err := s.arenas.AddMatch(arenaID, req)
	if err != nil {
		w.WriteHeader(http.StatusBadRequest)
		writeJSON(w, map[string]interface{}{"error": err.Error()})
		return
	}

	writeJSON(w, match)
}

func (s *Server) handleStartArena(w http.ResponseWriter, arenaID string) {
	err := s.arenas.StartArena(arenaID)
	if err != nil {
		w.WriteHeader(http.StatusBadRequest)
		writeJSON(w, map[string]interface{}{"error": err.Error()})
		return
	}

	// Begin the arena execution loop in a background goroutine
	go s.runArenaLoop(arenaID)

	arena := s.arenas.GetArena(arenaID)
	writeJSON(w, arena.Snapshot())
}

// ── Arena execution loop ──

func (s *Server) runArenaLoop(arenaID string) {
	for {
		matchID, duelIndex, duel, found := s.arenas.NextPendingDuel(arenaID)
		if !found {
			s.emitContextLog(&streamLogContext{ArenaID: arenaID}, "all duels complete")
			return
		}

		arena := s.arenas.GetArena(arenaID)
		if arena == nil {
			return
		}

		duelIndexRef := duelIndex
		ctx := &streamLogContext{
			ArenaID:   arenaID,
			MatchID:   matchID,
			DuelIndex: &duelIndexRef,
		}
		s.emitContextLog(ctx, fmt.Sprintf("running seed=%s, maxTurns=%d", duel.Seed, duel.MaxTurns))

		if err := s.arenas.MarkDuelRunning(arenaID, matchID, duelIndex); err != nil {
			s.emitContextLog(ctx, fmt.Sprintf("error marking duel running: %v", err))
			return
		}

		// Broadcast arena status update
		s.broadcastArenaUpdate(arenaID)

		// Run the duel as a self-contained board simulation
		leaderboard, turnReached, boardID, tokenStats, heroAssignments, finalSnap, allEvents := s.runArenaDuel(arena, matchID, duel)

		if err := s.arenas.RecordDuelResult(arenaID, matchID, duelIndex, leaderboard, turnReached, boardID, tokenStats, heroAssignments); err != nil {
			s.emitContextLog(ctx, fmt.Sprintf("error recording duel result: %v", err))
			return
		}

		s.emitContextLog(ctx, fmt.Sprintf("complete turns=%d, winner=%s, board=%s", turnReached, leaderboardWinner(leaderboard), boardID))
		if err := s.persistArenaArtifacts(arena, matchID, duelIndex, finalSnap, allEvents); err != nil {
			s.emitContextLog(ctx, fmt.Sprintf("trace write failed: %v", err))
		}

		// Broadcast arena status update after duel completes
		s.broadcastArenaUpdate(arenaID)

		// Small delay between duels to avoid overloading
		time.Sleep(500 * time.Millisecond)
	}
}

func (s *Server) runArenaDuel(arena *game.Arena, matchID string, duel *game.DuelResult) ([]game.ScoreTrack, int, string, []game.DuelHeroTokenStats, []game.DuelHeroAssignment, game.BoardSnapshot, []game.EventRecord) {
	arena.RLockBots()
	bots := arena.CopyBots()
	arena.RUnlockBots()

	// Create an isolated board for this duel
	boardID := game.NewID()
	board := game.NewBoard(boardID, duel.Seed, len(bots))
	board.SetLifecycle(game.LifecycleOpen)
	duelIndexRef := duel.DuelIndex
	ctx := &streamLogContext{
		ArenaID:   arena.ID,
		MatchID:   matchID,
		BoardID:   boardID,
		DuelIndex: &duelIndexRef,
	}
	heroBots := make(map[string]game.ArenaBotConfig, len(duel.BotPositions))
	heroTokens := make(map[string]*heroTokenAccum, len(duel.BotPositions))
	heroAssignments := make([]game.DuelHeroAssignment, 0, len(duel.BotPositions))

	// Register bot heroes according to the position assignment
	for spawnSlot := 0; spawnSlot < len(duel.BotPositions); spawnSlot++ {
		botIdx := duel.BotPositions[spawnSlot]
		if botIdx < 0 || botIdx >= len(bots) {
			s.emitContextLog(ctx, fmt.Sprintf("invalid bot index %d for spawn slot %d", botIdx, spawnSlot))
			continue
		}
		bot := bots[botIdx]

		reg := game.HeroRegistration{
			ID:       game.NewID(),
			Name:     fmt.Sprintf("%s (%s/%s)", bot.Label, bot.Provider, bot.Model),
			Strategy: bot.Strategy,
		}
		hero, err := board.RegisterHero(reg)
		if err != nil {
			s.emitContextLog(ctx, fmt.Sprintf("failed to register bot %d for duel: %v", botIdx, err))
			continue
		}
		heroBots[hero.ID] = bot
		heroTokens[hero.ID] = &heroTokenAccum{botIndex: botIdx}
		heroAssignments = append(heroAssignments, game.DuelHeroAssignment{
			HeroID:    hero.ID,
			HeroName:  hero.Name,
			BotIndex:  botIdx,
			SpawnSlot: spawnSlot,
		})
	}

	board.SetLifecycle(game.LifecycleRunning)
	s.mgr.RecordExternalBoard(board)

	for {
		if board.AllHeroesDoneOrDead() || board.Turn() >= duel.MaxTurns {
			break
		}

		submitStart := time.Now()
		submitEnd := submitStart.Add(time.Duration(s.planningMs) * time.Millisecond)
		s.setArenaTurnState(board.ID, arenaTurnState{
			Phase:           game.PhaseSubmit,
			PhaseStartAt:    submitStart,
			PhaseEndAt:      submitEnd,
			SubmitWindowMs:  s.planningMs,
			ResolveWindowMs: s.actionMs,
			Started:         true,
		})
		board.AddSystemEvent(fmt.Sprintf("Turn %d begins — submission window (%dms).", board.Turn(), s.planningMs))
		s.submitArenaBotActions(board, heroBots, heroTokens, ctx)
		s.broadcastSnapshot(board.Snapshot(s.getTurnState(board)))

		// Sleep only for remaining submit window
		if remaining := time.Until(submitEnd); remaining > 0 {
			time.Sleep(remaining)
		}

		resolveStart := time.Now()
		resolveEnd := resolveStart.Add(time.Duration(s.actionMs) * time.Millisecond)
		s.setArenaTurnState(board.ID, arenaTurnState{
			Phase:           game.PhaseResolve,
			PhaseStartAt:    resolveStart,
			PhaseEndAt:      resolveEnd,
			SubmitWindowMs:  s.planningMs,
			ResolveWindowMs: s.actionMs,
			Started:         true,
		})
		board.AddSystemEvent(fmt.Sprintf("Turn %d submissions locked — resolve window (%dms).", board.Turn(), s.actionMs))
		s.broadcastSnapshot(board.Snapshot(s.getTurnState(board)))
		time.Sleep(time.Duration(s.actionMs) * time.Millisecond)

		prevLastEventID := board.LastEventID()
		board.StepWorld()
		s.emitBoardEvents(board, ctx, prevLastEventID)
		s.broadcastSnapshot(board.Snapshot(s.getTurnState(board)))
	}

	board.SetLifecycle(game.LifecycleCompleted)
	s.setArenaTurnState(board.ID, arenaTurnState{
		Phase:           game.PhaseSubmit,
		PhaseStartAt:    time.Now(),
		PhaseEndAt:      time.Now(),
		SubmitWindowMs:  s.planningMs,
		ResolveWindowMs: s.actionMs,
		Started:         false,
	})
	s.broadcastSnapshot(board.Snapshot(s.getTurnState(board)))

	turnState := game.TurnState{Turn: board.Turn(), Phase: game.PhaseSubmit}
	snap := board.Snapshot(turnState)
	allEvents := board.EventsAfterID("")

	// Collect token stats
	var tokenStats []game.DuelHeroTokenStats
	for heroID, acc := range heroTokens {
		if acc.llmCalls > 0 || acc.fallbacks > 0 {
			tokenStats = append(tokenStats, game.DuelHeroTokenStats{
				HeroID:           heroID,
				BotIndex:         acc.botIndex,
				PromptTokens:     acc.promptTokens,
				CompletionTokens: acc.completionTokens,
				TotalTokens:      acc.totalTokens,
				LLMCalls:         acc.llmCalls,
				Fallbacks:        acc.fallbacks,
			})
		}
	}

	return snap.Leaderboard, board.Turn(), boardID, tokenStats, heroAssignments, snap, allEvents
}

func (s *Server) submitArenaBotActions(board *game.Board, heroBots map[string]game.ArenaBotConfig, heroTokens map[string]*heroTokenAccum, ctx *streamLogContext) {
	heroIDs := make([]string, 0, len(heroBots))
	for heroID := range heroBots {
		heroIDs = append(heroIDs, heroID)
	}
	sort.Strings(heroIDs)

	// Determine LLM call timeout: leave 200ms buffer within the submit window
	llmTimeout := time.Duration(s.planningMs-200) * time.Millisecond
	if llmTimeout < 500*time.Millisecond {
		llmTimeout = 500 * time.Millisecond
	}

	type actionResult struct {
		heroID string
		action game.HeroAction
		ok     bool
		usage  *llmResult
		used   string // "llm" or "heuristic"
	}

	results := make([]actionResult, len(heroIDs))
	var wg sync.WaitGroup

	for i, heroID := range heroIDs {
		wg.Add(1)
		go func(idx int, hid string, bot game.ArenaBotConfig) {
			defer wg.Done()

			// Try LLM first
			action, ok, usage := chooseArenaActionViaLLM(board, hid, bot, llmTimeout)
			if ok {
				results[idx] = actionResult{heroID: hid, action: action, ok: true, usage: usage, used: "llm"}
				return
			}

			// Fall back to heuristic
			action, ok = chooseArenaBotAction(board, hid, bot)
			results[idx] = actionResult{heroID: hid, action: action, ok: ok, usage: usage, used: "heuristic"}
		}(i, heroID, heroBots[heroID])
	}

	wg.Wait()

	for _, res := range results {
		if !res.ok {
			continue
		}

		// Track token usage
		if acc, exists := heroTokens[res.heroID]; exists {
			if res.usage != nil {
				acc.promptTokens += res.usage.promptTokens
				acc.completionTokens += res.usage.completionTokens
				acc.totalTokens += res.usage.totalTokens
				acc.llmCalls++
			}
			if res.used == "heuristic" {
				acc.fallbacks++
			}
		}

		bot := heroBots[res.heroID]
		accepted, msg := board.SubmitAction(res.heroID, res.action)
		if res.usage != nil && res.usage.trace != nil {
			res.usage.trace.DecisionSource = res.used
			res.usage.trace.SubmittedAction = fmt.Sprintf("%s%s", res.action.Kind, dirSuffix(res.action.Direction))
			res.usage.trace.QueueAccepted = accepted
			res.usage.trace.QueueMessage = msg
			if err := s.persistArenaPromptTrace(ctx, res.usage.trace); err != nil {
				s.emitContextLog(ctx, fmt.Sprintf("prompt trace write failed: %v", err))
			}
		}
		if accepted {
			s.emitContextLog(ctx, fmt.Sprintf("%s queued %s%s [%s]", res.heroID, res.action.Kind, dirSuffix(res.action.Direction), res.used))
			continue
		}
		s.emitContextLog(ctx, fmt.Sprintf("failed to queue action for %s (%s): %s", res.heroID, bot.Label, msg))
	}
}

func chooseArenaBotAction(board *game.Board, heroID string, bot game.ArenaBotConfig) (game.HeroAction, bool) {
	vision, err := board.GetVision(heroID)
	if err != nil || vision == nil || vision.Hero == nil {
		return game.HeroAction{}, false
	}
	hero := vision.Hero
	if hero.Status != game.StatusAlive {
		return game.HeroAction{}, false
	}
	actions := vision.LegalActions
	if len(actions) == 0 {
		return game.HeroAction{Kind: game.ActionWait}, true
	}

	moveActions := make([]game.LegalAction, 0)
	moveByDirection := make(map[game.Direction]game.HeroAction)
	var restAction *game.HeroAction
	var waitAction *game.HeroAction
	for _, action := range actions {
		switch action.Kind {
		case game.ActionMove:
			moveActions = append(moveActions, action)
			moveByDirection[action.Direction] = action.HeroAction
		case game.ActionRest:
			copy := action.HeroAction
			restAction = &copy
		case game.ActionWait:
			copy := action.HeroAction
			waitAction = &copy
		}
	}

	strategy := strings.ToLower(strings.TrimSpace(bot.Strategy))
	isAggressive := strings.Contains(strategy, "berserker") || strings.Contains(strategy, "kill") || strings.Contains(strategy, "combat")
	isExplorer := strings.Contains(strategy, "explor") || strings.Contains(strategy, "map")
	isTreasure := strings.Contains(strategy, "treasure") || strings.Contains(strategy, "loot") || strings.Contains(strategy, "gold")
	restHeal := hero.Stats.MaxHp - hero.Stats.Hp
	if restHeal > game.CFG.RestHeal {
		restHeal = game.CFG.RestHeal
	}

	if hero.Stats.Hp <= hero.Stats.MaxHp/2 {
		for _, action := range actions {
			if action.Kind == game.ActionUseItem && strings.Contains(strings.ToLower(action.Description), "health potion") {
				return action.HeroAction, true
			}
		}
	}

	for _, action := range actions {
		if action.Kind == game.ActionInteract && strings.Contains(strings.ToLower(action.Description), "free ") {
			return action.HeroAction, true
		}
	}

	if isAggressive {
		for _, action := range actions {
			if action.Kind == game.ActionAttack {
				return action.HeroAction, true
			}
		}
	}

	if hero.Score >= 20 || hero.Stats.Hp <= hero.Stats.MaxHp/3 {
		for _, action := range actions {
			if action.Kind == game.ActionMove && strings.Contains(action.Description, "ESCAPE") {
				return action.HeroAction, true
			}
		}
	}

	for _, action := range actions {
		if action.Kind == game.ActionInteract && strings.Contains(strings.ToLower(action.Description), "pray") && hero.Stats.Hp < hero.Stats.MaxHp {
			return action.HeroAction, true
		}
	}

	for _, action := range actions {
		if action.Kind == game.ActionUseItem && strings.Contains(strings.ToLower(action.Description), "equip ") {
			return action.HeroAction, true
		}
	}

	for _, targets := range heuristicTargetGroups(vision, isAggressive, isExplorer, isTreasure) {
		if len(targets) == 0 {
			continue
		}
		direction, ok := board.NextStepToward(heroID, targets)
		if !ok {
			continue
		}
		if action, exists := moveByDirection[direction]; exists {
			return action, true
		}
	}

	priorityTerms := []string{"treasure", "health potion", "open chest"}
	if isTreasure {
		priorityTerms = append([]string{"treasure", "chest", "gold", "potion"}, priorityTerms...)
	}
	if isExplorer {
		priorityTerms = append(priorityTerms, "door")
	}

	for _, term := range priorityTerms {
		for _, action := range moveActions {
			if strings.Contains(strings.ToLower(action.Description), term) {
				return action.HeroAction, true
			}
		}
	}

	if !isAggressive {
		for _, action := range actions {
			if action.Kind == game.ActionAttack {
				return action.HeroAction, true
			}
		}
	}

	for _, action := range moveActions {
		desc := strings.ToLower(action.Description)
		if strings.Contains(desc, "lava") || strings.Contains(desc, "trap") {
			continue
		}
		return action.HeroAction, true
	}

	if hero.Fatigue >= 65 {
		if restHeal > 0 && restAction != nil {
			return *restAction, true
		}
		if waitAction != nil {
			return *waitAction, true
		}
		if restAction != nil && hero.Fatigue >= 80 {
			return *restAction, true
		}
	}

	if waitAction != nil {
		return *waitAction, true
	}

	if restHeal > 0 && restAction != nil {
		return *restAction, true
	}

	return game.HeroAction{Kind: game.ActionWait}, true
}

func heuristicTargetGroups(vision *game.VisionData, isAggressive, isExplorer, isTreasure bool) [][]game.Position {
	groups := make([][]game.Position, 0, 6)
	if vision == nil || vision.Hero == nil {
		return groups
	}

	if isAggressive {
		if positions := adjacentApproachTargets(visibleMonsterPositions(vision)); len(positions) > 0 {
			groups = append(groups, positions)
		}
		if positions := discoveryTargets(vision, game.SpellLocateMonsters, true); len(positions) > 0 {
			groups = append(groups, positions)
		}
	}

	if positions := visibleItemPositions(vision); len(positions) > 0 {
		groups = append(groups, positions)
	}

	if isTreasure || isExplorer {
		if positions := discoveryTargets(vision, game.SpellLocateTreasury, false); len(positions) > 0 {
			groups = append(groups, positions)
		}
	}

	if isExplorer {
		if positions := discoveryTargets(vision, game.SpellLocateBuildings, false); len(positions) > 0 {
			groups = append(groups, positions)
		}
		if positions := discoveryTargets(vision, game.SpellLocatePrisoner, false); len(positions) > 0 {
			groups = append(groups, positions)
		}
	}

	if positions := visibleNpcPositions(vision); len(positions) > 0 {
		groups = append(groups, positions)
	}

	return groups
}

func visibleMonsterPositions(vision *game.VisionData) []game.Position {
	positions := make([]game.Position, 0, len(vision.VisibleMonsters))
	for _, monster := range vision.VisibleMonsters {
		positions = append(positions, monster.Position)
	}
	return positions
}

func visibleItemPositions(vision *game.VisionData) []game.Position {
	positions := make([]game.Position, 0, len(vision.VisibleItems))
	for _, item := range vision.VisibleItems {
		positions = append(positions, item.Position)
	}
	return positions
}

func visibleNpcPositions(vision *game.VisionData) []game.Position {
	positions := make([]game.Position, 0, len(vision.VisibleNpcs))
	for _, npc := range vision.VisibleNpcs {
		positions = append(positions, npc.Position)
	}
	return positions
}

func discoveryTargets(vision *game.VisionData, spell game.SpellKind, adjacent bool) []game.Position {
	positions := make([]game.Position, 0)
	for _, discovery := range vision.SpellDiscoveries {
		if discovery.Spell != spell {
			continue
		}
		positions = append(positions, discovery.Positions...)
	}
	if adjacent {
		return adjacentApproachTargets(positions)
	}
	return positions
}

func adjacentApproachTargets(targets []game.Position) []game.Position {
	positions := make([]game.Position, 0, len(targets)*4)
	for _, target := range targets {
		for _, direction := range game.AllDirections {
			positions = append(positions, game.MoveInDir(target, direction))
		}
	}
	return positions
}

func (s *Server) broadcastArenaUpdate(arenaID string) {
	arena := s.arenas.GetArena(arenaID)
	if arena == nil {
		return
	}
	s.broadcast("arena", arena.Snapshot())
}

func leaderboardWinner(lb []game.ScoreTrack) string {
	if len(lb) == 0 {
		return "(none)"
	}
	return lb[0].HeroName
}
