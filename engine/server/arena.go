package server

import (
	"encoding/json"
	"fmt"
	"net/http"
	"sort"
	"strings"
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
		leaderboard, turnReached, boardID := s.runArenaDuel(arena, matchID, duel)

		if err := s.arenas.RecordDuelResult(arenaID, matchID, duelIndex, leaderboard, turnReached, boardID); err != nil {
			s.emitContextLog(ctx, fmt.Sprintf("error recording duel result: %v", err))
			return
		}

		s.emitContextLog(ctx, fmt.Sprintf("complete turns=%d, winner=%s, board=%s", turnReached, leaderboardWinner(leaderboard), boardID))

		// Broadcast arena status update after duel completes
		s.broadcastArenaUpdate(arenaID)

		// Small delay between duels to avoid overloading
		time.Sleep(500 * time.Millisecond)
	}
}

func (s *Server) runArenaDuel(arena *game.Arena, matchID string, duel *game.DuelResult) ([]game.ScoreTrack, int, string) {
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
		s.submitArenaBotActions(board, heroBots, ctx)
		s.broadcastSnapshot(board.Snapshot(s.getTurnState(board)))
		time.Sleep(time.Duration(s.planningMs) * time.Millisecond)

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

	return snap.Leaderboard, board.Turn(), boardID
}

func (s *Server) submitArenaBotActions(board *game.Board, heroBots map[string]game.ArenaBotConfig, ctx *streamLogContext) {
	heroIDs := make([]string, 0, len(heroBots))
	for heroID := range heroBots {
		heroIDs = append(heroIDs, heroID)
	}
	sort.Strings(heroIDs)

	for _, heroID := range heroIDs {
		bot := heroBots[heroID]
		action, ok := chooseArenaBotAction(board, heroID, bot)
		if !ok {
			continue
		}
		accepted, msg := board.SubmitAction(heroID, action)
		if accepted {
			s.emitContextLog(ctx, fmt.Sprintf("%s queued %s%s", heroID, action.Kind, dirSuffix(action.Direction)))
			continue
		}
		s.emitContextLog(ctx, fmt.Sprintf("failed to queue action for %s (%s): %s", heroID, bot.Label, msg))
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

	strategy := strings.ToLower(strings.TrimSpace(bot.Strategy))
	isAggressive := strings.Contains(strategy, "berserker") || strings.Contains(strategy, "kill") || strings.Contains(strategy, "combat")
	isExplorer := strings.Contains(strategy, "explor") || strings.Contains(strategy, "map")
	isTreasure := strings.Contains(strategy, "treasure") || strings.Contains(strategy, "loot") || strings.Contains(strategy, "gold")

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

	moveActions := make([]game.LegalAction, 0)
	for _, action := range actions {
		if action.Kind == game.ActionMove {
			moveActions = append(moveActions, action)
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

	for _, action := range moveActions {
		return action.HeroAction, true
	}

	for _, action := range actions {
		if action.Kind == game.ActionRest {
			return action.HeroAction, true
		}
	}

	return game.HeroAction{Kind: game.ActionWait}, true
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
