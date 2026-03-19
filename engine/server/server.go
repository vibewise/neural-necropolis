package server

import (
	"bufio"
	"encoding/json"
	"errors"
	"fmt"
	"log"
	"net/http"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"sync"
	"time"

	"github.com/mmorph/engine/game"
)

type Server struct {
	mgr           *game.Manager
	planningMs    int
	actionMs      int
	warmupMs      int
	startUnlockAt time.Time
	maxTurns      int
	port          int
	turnPhase     game.TurnPhase
	phaseStartAt  time.Time
	phaseEndAt    time.Time
	phaseTimer    *time.Timer
	mu            sync.RWMutex
	streamClients map[*sseClient]bool
	streamMu      sync.Mutex
	dashboardHTML string
	gameSettings  game.GameSettings
}

type sseClient struct {
	w       http.ResponseWriter
	flusher http.Flusher
	done    chan struct{}
}

var (
	dotenvOnce sync.Once
	dotenvVals map[string]string
)

func New() *Server {
	port, _ := strconv.Atoi(envOr("PORT", "3000"))
	planningMs, _ := strconv.Atoi(envOr("BEAT_PLANNING_MS", "12000"))
	actionMs, _ := strconv.Atoi(envOr("BEAT_ACTION_MS", "500"))
	if actionMs <= 0 {
		actionMs = 500
	}
	warmupMs, _ := strconv.Atoi(envOr("BOARD_WARMUP_MS", "0"))
	maxTurns, _ := strconv.Atoi(envOr("MAX_BOARD_TURNS", strconv.Itoa(game.CFG.MaxTurnsPerBoard)))

	return &Server{
		mgr:           game.NewManager(),
		planningMs:    planningMs,
		actionMs:      actionMs,
		warmupMs:      warmupMs,
		maxTurns:      maxTurns,
		port:          port,
		turnPhase:     game.PhaseSubmit,
		phaseStartAt:  time.Now(),
		phaseEndAt:    time.Now().Add(time.Duration(planningMs) * time.Millisecond),
		streamClients: make(map[*sseClient]bool),
		dashboardHTML: DashboardHTML,
		gameSettings:  game.GameSettings{Paused: true},
	}
}

func (s *Server) Run() {
	initialBoard := s.mgr.EnsureOpenBoard()
	if s.warmupMs > 0 {
		s.mu.Lock()
		s.startUnlockAt = time.Now().Add(time.Duration(s.warmupMs) * time.Millisecond)
		s.mu.Unlock()
		if initialBoard != nil {
			initialBoard.AddSystemEvent(fmt.Sprintf("Global warm-up active for %.1fs before auto-start unlocks.", float64(s.warmupMs)/1000))
		}
	}

	go s.autoStartLoop()

	mux := http.NewServeMux()
	mux.HandleFunc("/", s.handleDashboard)
	mux.HandleFunc("/api/health", s.handleHealth)
	mux.HandleFunc("/api/dashboard", s.handleDashboardAPI)
	mux.HandleFunc("/api/boards", s.handleBoards)
	mux.HandleFunc("/api/boards/completed", s.handleCompletedBoards)
	mux.HandleFunc("/api/stream", s.handleStream)
	mux.HandleFunc("/api/heroes/register", s.handleRegister)
	mux.HandleFunc("/api/heroes/", s.handleHeroRoutes)
	mux.HandleFunc("/api/admin/start", s.handleAdminStart)
	mux.HandleFunc("/api/admin/stop", s.handleAdminStop)
	mux.HandleFunc("/api/admin/reset", s.handleAdminReset)
	mux.HandleFunc("/api/admin/settings", s.handleAdminSettings)
	mux.HandleFunc("/api/seed", s.handleSeed)
	mux.HandleFunc("/api/leaderboard", s.handleLeaderboard)

	host := envOr("HOST", "127.0.0.1")
	addr := fmt.Sprintf("%s:%d", host, s.port)
	displayHost := host
	if host == "0.0.0.0" {
		displayHost = "localhost"
	}
	log.Printf("Neural Necropolis engine on http://%s:%d | submit=%s resolve=%s", displayHost, s.port, formatWindowMs(s.planningMs), formatWindowMs(s.actionMs))
	log.Fatal(http.ListenAndServe(addr, withCORS(mux)))
}

func formatWindowMs(ms int) string {
	seconds := float64(ms) / 1000
	switch {
	case ms%1000 == 0:
		return fmt.Sprintf("%.0fs", seconds)
	case ms%100 == 0:
		return fmt.Sprintf("%.1fs", seconds)
	default:
		return fmt.Sprintf("%.2fs", seconds)
	}
}

func (s *Server) autoStartLoop() {
	ticker := time.NewTicker(250 * time.Millisecond)
	defer ticker.Stop()
	for range ticker.C {
		s.mu.RLock()
		paused := s.gameSettings.Paused
		s.mu.RUnlock()
		if paused {
			continue
		}
		if started, ok := s.tryAutoStartBoard(); ok {
			s.startBeatLoop(started)
			s.broadcastSnapshot(started.Snapshot(s.getTurnState(started)))
			s.emitLog(fmt.Sprintf("Board %s auto-started.", started.ID))
		}
	}
}

func (s *Server) warmupRemainingMs(now time.Time) int64 {
	s.mu.RLock()
	defer s.mu.RUnlock()
	if s.startUnlockAt.IsZero() || !now.Before(s.startUnlockAt) {
		return 0
	}
	remaining := s.startUnlockAt.Sub(now).Milliseconds()
	if remaining < 0 {
		return 0
	}
	return remaining
}

func (s *Server) tryAutoStartBoard() (*game.Board, bool) {
	if s.warmupRemainingMs(time.Now()) > 0 {
		return nil, false
	}
	return s.mgr.TryAutoStart()
}

// ── Turn phase state machine ──

func (s *Server) getTurnState(board *game.Board) game.TurnState {
	s.mu.RLock()
	defer s.mu.RUnlock()
	now := time.Now()
	seed := ""
	turn := 0
	warmupRemainingMs := int64(0)
	if board != nil {
		seed = board.Seed()
		turn = board.Turn()
	}
	if !s.startUnlockAt.IsZero() && now.Before(s.startUnlockAt) {
		warmupRemainingMs = s.startUnlockAt.Sub(now).Milliseconds()
		if warmupRemainingMs < 0 {
			warmupRemainingMs = 0
		}
	}
	return game.TurnState{
		Turn:              turn,
		Phase:             s.turnPhase,
		Started:           board != nil && board.Lifecycle() == game.LifecycleRunning,
		SubmitWindowMs:    int64(s.planningMs),
		ResolveWindowMs:   int64(s.actionMs),
		PhaseEndsAt:       s.phaseEndAt.UnixMilli(),
		PhaseDurationMs:   s.phaseEndAt.Sub(s.phaseStartAt).Milliseconds(),
		PhaseElapsedMs:    now.Sub(s.phaseStartAt).Milliseconds(),
		Seed:              seed,
		WarmupRemainingMs: warmupRemainingMs,
	}
}

func (s *Server) startBeatLoop(board *game.Board) {
	s.mu.Lock()
	if s.phaseTimer != nil {
		s.phaseTimer.Stop()
	}
	s.turnPhase = game.PhaseSubmit
	s.phaseStartAt = time.Now()
	s.phaseEndAt = time.Now().Add(time.Duration(s.planningMs) * time.Millisecond)
	s.mu.Unlock()

	board.AddSystemEvent(fmt.Sprintf("Turn %d begins — submission window (%dms).", board.Turn(), s.planningMs))
	s.emitLog(fmt.Sprintf("Turn %d — SUBMIT window (%s)", board.Turn(), formatWindowMs(s.planningMs)))
	s.broadcastSnapshot(board.Snapshot(s.getTurnState(board)))

	s.scheduleBeat(board, time.Duration(s.planningMs)*time.Millisecond)
}

func (s *Server) stopBeatLoop() {
	s.mu.Lock()
	defer s.mu.Unlock()
	if s.phaseTimer != nil {
		s.phaseTimer.Stop()
		s.phaseTimer = nil
	}
}

func (s *Server) scheduleBeat(board *game.Board, d time.Duration) {
	s.mu.Lock()
	defer s.mu.Unlock()
	if s.phaseTimer != nil {
		s.phaseTimer.Stop()
	}
	s.phaseTimer = time.AfterFunc(d, func() {
		s.transitionPhase(board)
	})
}

func (s *Server) transitionPhase(board *game.Board) {
	if board.Lifecycle() != game.LifecycleRunning {
		return
	}

	s.mu.Lock()
	if s.turnPhase == game.PhaseSubmit {
		s.turnPhase = game.PhaseResolve
		s.phaseStartAt = time.Now()
		s.phaseEndAt = time.Now().Add(time.Duration(s.actionMs) * time.Millisecond)
		s.mu.Unlock()

		board.AddSystemEvent(fmt.Sprintf("Turn %d submissions locked — resolve window (%dms).", board.Turn(), s.actionMs))

		snap := board.Snapshot(s.getTurnState(board))
		s.broadcastSnapshot(snap)
		s.emitLog(fmt.Sprintf("Turn %d — RESOLVE window (%s)", board.Turn(), formatWindowMs(s.actionMs)))
		s.scheduleBeat(board, time.Duration(s.actionMs)*time.Millisecond)
		return
	}

	// Resolve window ended → apply submitted actions
	s.mu.Unlock()
	prevEventCount := board.EventCount()
	board.StepWorld()
	s.emitBoardEvents(board, prevEventCount)

	if board.Turn() >= s.maxTurns {
		s.finishBoard(board, fmt.Sprintf("Turn limit reached (%d).", s.maxTurns))
		return
	}

	// Check if all heroes are done
	if board.AllHeroesDoneOrDead() {
		s.finishBoard(board, "All heroes have finished.")
		return
	}

	// If paused, stop cycling — user must resume manually
	s.mu.RLock()
	paused := s.gameSettings.Paused
	s.mu.RUnlock()
	if paused {
		board.AddSystemEvent(fmt.Sprintf("Turn %d resolved. Turns paused — waiting for resume.", board.Turn()))
		snap := board.Snapshot(s.getTurnState(board))
		s.broadcastSnapshot(snap)
		s.emitLog(fmt.Sprintf("Turn %d resolved. Paused.", board.Turn()))
		return
	}

	s.mu.Lock()
	s.turnPhase = game.PhaseSubmit
	s.phaseStartAt = time.Now()
	s.phaseEndAt = time.Now().Add(time.Duration(s.planningMs) * time.Millisecond)
	s.mu.Unlock()

	board.AddSystemEvent(fmt.Sprintf("Turn %d begins — submission window (%dms).", board.Turn(), s.planningMs))

	snap := board.Snapshot(s.getTurnState(board))
	s.broadcastSnapshot(snap)
	s.emitLog(fmt.Sprintf("Turn %d — SUBMIT window (%.0fs)", board.Turn(), float64(s.planningMs)/1000))
	s.scheduleBeat(board, time.Duration(s.planningMs)*time.Millisecond)
}

// ── SSE broadcasting ──

func (s *Server) broadcastSnapshot(snap game.BoardSnapshot) {
	s.mu.RLock()
	settings := s.gameSettings
	s.mu.RUnlock()
	raw, _ := json.Marshal(snap)
	var combined map[string]interface{}
	json.Unmarshal(raw, &combined)
	combined["gameSettings"] = settings
	s.broadcast("snapshot", combined)
}

func (s *Server) broadcast(eventType string, payload interface{}) {
	var data string
	switch v := payload.(type) {
	case string:
		data = v
	default:
		b, _ := json.Marshal(v)
		data = string(b)
	}
	msg := fmt.Sprintf("event: %s\ndata: %s\n\n", eventType, data)

	s.streamMu.Lock()
	defer s.streamMu.Unlock()
	for client := range s.streamClients {
		_, err := fmt.Fprint(client.w, msg)
		if err != nil {
			delete(s.streamClients, client)
			close(client.done)
			continue
		}
		client.flusher.Flush()
	}
}

func (s *Server) emitLog(message string) {
	log.Printf("%s", message)
	s.broadcast("log", message)
}

func (s *Server) emitBoardEvents(board *game.Board, previousCount int) {
	for _, event := range board.EventsSince(previousCount) {
		s.emitLog(fmt.Sprintf("[%s] %s", strings.ToUpper(string(event.Type)), event.Summary))
	}
}

func (s *Server) boardWinnerSummary(board *game.Board) string {
	snap := board.Snapshot(s.getTurnState(board))
	if len(snap.Leaderboard) == 0 {
		return "No winner"
	}
	winner := snap.Leaderboard[0]
	return fmt.Sprintf("Winner: %s with %d pts.", winner.HeroName, winner.TotalScore)
}

func (s *Server) finishBoard(board *game.Board, reason string) {
	s.stopBeatLoop()
	fullReason := strings.TrimSpace(reason + " " + s.boardWinnerSummary(board))
	s.mgr.CompleteBoard(board.ID, fullReason)
	s.mu.Lock()
	s.turnPhase = game.PhaseSubmit
	s.phaseStartAt = time.Now()
	s.phaseEndAt = time.Now()
	s.mu.Unlock()

	snap := board.Snapshot(s.getTurnState(board))
	s.broadcastSnapshot(snap)
	s.emitLog(fullReason)

	if newBoard, started := s.tryAutoStartBoard(); started {
		s.startBeatLoop(newBoard)
		s.broadcastSnapshot(newBoard.Snapshot(s.getTurnState(newBoard)))
	}
}

// ── Route handlers ──

func (s *Server) handleDashboard(w http.ResponseWriter, r *http.Request) {
	if r.URL.Path != "/" {
		http.NotFound(w, r)
		return
	}
	w.Header().Set("Content-Type", "text/html; charset=utf-8")
	fmt.Fprint(w, s.dashboardHTML)
}

func (s *Server) handleHealth(w http.ResponseWriter, _ *http.Request) {
	board := s.mgr.ActiveBoard()
	writeJSON(w, map[string]interface{}{
		"ok":        true,
		"turnState": s.getTurnState(board),
	})
}

func (s *Server) handleDashboardAPI(w http.ResponseWriter, r *http.Request) {
	var board *game.Board
	if bid := r.URL.Query().Get("boardId"); bid != "" {
		board = s.mgr.GetBoard(bid)
	}
	if board == nil {
		board = s.mgr.ActiveBoard()
	}
	if board == nil {
		board = s.mgr.EnsureOpenBoard()
	}
	snap := board.Snapshot(s.getTurnState(board))
	s.mu.RLock()
	settings := s.gameSettings
	s.mu.RUnlock()
	// Embed gameSettings into the snapshot JSON by wrapping both into a combined map
	raw, _ := json.Marshal(snap)
	var combined map[string]interface{}
	json.Unmarshal(raw, &combined)
	combined["gameSettings"] = settings
	writeJSON(w, combined)
}

func (s *Server) handleBoards(w http.ResponseWriter, _ *http.Request) {
	writeJSON(w, s.mgr.Snapshot())
}

func (s *Server) handleCompletedBoards(w http.ResponseWriter, r *http.Request) {
	type completedBoardView struct {
		BoardID          string            `json:"boardId"`
		BoardSlug        string            `json:"boardSlug"`
		BoardName        string            `json:"boardName"`
		Turn             int               `json:"turn"`
		CompletionReason string            `json:"completionReason"`
		Seed             string            `json:"seed"`
		HeroCount        int               `json:"heroCount"`
		MonsterCount     int               `json:"monsterCount"`
		TopLeaderboard   []game.ScoreTrack `json:"topLeaderboard"`
	}

	offset := parseQueryInt(r, "offset", 0)
	limit := parseQueryInt(r, "limit", 6)
	if offset < 0 {
		offset = 0
	}
	if limit <= 0 {
		limit = 6
	}
	if limit > 50 {
		limit = 50
	}

	boards := s.mgr.AllBoards()
	allCompleted := make([]completedBoardView, 0)
	for i := len(boards) - 1; i >= 0; i-- {
		board := boards[i]
		if board.Lifecycle() != game.LifecycleCompleted {
			continue
		}
		snap := board.Snapshot(s.getTurnState(board))
		top := snap.Leaderboard
		if len(top) > 5 {
			top = top[:5]
		}
		allCompleted = append(allCompleted, completedBoardView{
			BoardID:          snap.BoardID,
			BoardSlug:        snap.BoardSlug,
			BoardName:        snap.World.DungeonName,
			Turn:             snap.World.Turn,
			CompletionReason: snap.Lobby.CompletionReason,
			Seed:             snap.Seed,
			HeroCount:        len(snap.Heroes),
			MonsterCount:     len(snap.Monsters),
			TopLeaderboard:   top,
		})
	}

	total := len(allCompleted)
	if offset > total {
		offset = total
	}
	end := offset + limit
	if end > total {
		end = total
	}
	result := allCompleted[offset:end]

	writeJSON(w, map[string]interface{}{
		"boards": result,
		"total":  total,
		"offset": offset,
		"limit":  limit,
	})
}

func (s *Server) handleSeed(w http.ResponseWriter, _ *http.Request) {
	board := s.mgr.ActiveBoard()
	seed := ""
	if board != nil {
		seed = board.Seed()
	}
	writeJSON(w, map[string]string{"seed": seed})
}

func (s *Server) handleLeaderboard(w http.ResponseWriter, _ *http.Request) {
	board := s.mgr.ActiveBoard()
	if board == nil {
		writeJSON(w, map[string]interface{}{"leaderboard": []interface{}{}})
		return
	}
	snap := board.Snapshot(s.getTurnState(board))
	writeJSON(w, map[string]interface{}{"leaderboard": snap.Leaderboard})
}

func (s *Server) handleStream(w http.ResponseWriter, r *http.Request) {
	flusher, ok := w.(http.Flusher)
	if !ok {
		http.Error(w, "streaming not supported", http.StatusInternalServerError)
		return
	}

	w.Header().Set("Content-Type", "text/event-stream")
	w.Header().Set("Cache-Control", "no-cache, no-transform")
	w.Header().Set("Connection", "keep-alive")

	board := s.mgr.ActiveBoard()
	if board == nil {
		board = s.mgr.EnsureOpenBoard()
	}
	snap := board.Snapshot(s.getTurnState(board))
	data, _ := json.Marshal(snap)
	fmt.Fprintf(w, "event: snapshot\ndata: %s\n\n", data)
	flusher.Flush()

	client := &sseClient{w: w, flusher: flusher, done: make(chan struct{})}
	s.streamMu.Lock()
	s.streamClients[client] = true
	s.streamMu.Unlock()

	// Block until client disconnects
	<-r.Context().Done()
	s.streamMu.Lock()
	delete(s.streamClients, client)
	s.streamMu.Unlock()
}

func (s *Server) handleRegister(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
		return
	}

	var input game.HeroRegistration
	if err := json.NewDecoder(r.Body).Decode(&input); err != nil {
		http.Error(w, "invalid json", http.StatusBadRequest)
		return
	}

	// Register on the earliest open board with room.
	board, hero, err := s.mgr.RegisterHero(input)
	if err != nil {
		if errors.Is(err, game.ErrHeroCapacityReached) {
			w.WriteHeader(http.StatusConflict)
			writeJSON(w, map[string]interface{}{
				"error":     "hero_capacity_reached",
				"message":   err.Error(),
				"turnState": s.getTurnState(board),
			})
			return
		}
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}

	board.AddSystemEvent(fmt.Sprintf("%s entered the dungeon.", hero.Name))

	// Broadcast updated snapshot
	snap := board.Snapshot(s.getTurnState(board))
	s.broadcastSnapshot(snap)
	s.emitLog(fmt.Sprintf("%s joined — \"%s\" [%s]", hero.Name, hero.Strategy, hero.Trait))

	// Auto-start check
	if started, ok := s.tryAutoStartBoard(); ok {
		s.startBeatLoop(started)
		snap = started.Snapshot(s.getTurnState(started))
		s.broadcastSnapshot(snap)
		s.emitLog(fmt.Sprintf("Board %s auto-started!", started.ID))
	}

	resp := map[string]interface{}{
		"id":        hero.ID,
		"name":      hero.Name,
		"trait":     hero.Trait,
		"strategy":  hero.Strategy,
		"stats":     hero.Stats,
		"position":  hero.Position,
		"boardId":   board.ID,
		"turnState": s.getTurnState(board),
	}
	writeJSON(w, resp)
}

func (s *Server) handleHeroRoutes(w http.ResponseWriter, r *http.Request) {
	// Routes: /api/heroes/:heroId/observe, /api/heroes/:heroId/act, /api/heroes/:heroId/log
	parts := strings.Split(strings.TrimPrefix(r.URL.Path, "/api/heroes/"), "/")
	if len(parts) < 2 {
		http.NotFound(w, r)
		return
	}
	heroID := parts[0]
	action := parts[1]

	board := s.mgr.FindBoardForHero(heroID)
	if board == nil {
		http.Error(w, "hero not found on any board", http.StatusNotFound)
		return
	}

	switch action {
	case "observe":
		if r.Method != http.MethodGet {
			http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
			return
		}
		vision, err := board.GetVision(heroID)
		if err != nil {
			http.Error(w, err.Error(), http.StatusNotFound)
			return
		}
		resp := map[string]interface{}{
			"seed":            vision.Seed,
			"turn":            vision.Turn,
			"boardId":         board.ID,
			"boardStatus":     board.Lifecycle(),
			"hero":            vision.Hero,
			"visibleTiles":    vision.VisibleTiles,
			"visibleMonsters": vision.VisibleMonsters,
			"visibleHeroes":   vision.VisibleHeroes,
			"visibleNpcs":     vision.VisibleNpcs,
			"visibleItems":    vision.VisibleItems,
			"recentEvents":    vision.RecentEvents,
			"legalActions":    vision.LegalActions,
			"turnState":       s.getTurnState(board),
		}
		s.mu.RLock()
		settings := s.gameSettings
		s.mu.RUnlock()
		if settings.IncludeLandmarks {
			resp["landmarks"] = board.GetLandmarks(10)
		}
		if settings.IncludePlayerPositions {
			resp["allHeroPositions"] = board.GetAllHeroPositions()
		}
		resp["gameSettings"] = settings
		writeJSON(w, resp)

	case "act":
		if r.Method != http.MethodPost {
			http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
			return
		}
		s.mu.RLock()
		phase := s.turnPhase
		s.mu.RUnlock()

		if phase != game.PhaseSubmit {
			w.WriteHeader(http.StatusConflict)
			writeJSON(w, map[string]interface{}{
				"error":     "wrong_phase",
				"message":   fmt.Sprintf("Actions only accepted during submit phase. Current: %s", phase),
				"turnState": s.getTurnState(board),
			})
			return
		}

		var heroAction game.HeroAction
		if err := json.NewDecoder(r.Body).Decode(&heroAction); err != nil {
			http.Error(w, "invalid json", http.StatusBadRequest)
			return
		}

		accepted, msg := board.SubmitAction(heroID, heroAction)
		if accepted {
			s.emitLog(fmt.Sprintf("%s → %s%s", heroID, heroAction.Kind, dirSuffix(heroAction.Direction)))
		} else {
			s.emitLog(fmt.Sprintf("%s rejected action %s%s: %s", heroID, heroAction.Kind, dirSuffix(heroAction.Direction), msg))
		}
		writeJSON(w, map[string]interface{}{
			"accepted":  accepted,
			"message":   msg,
			"turnState": s.getTurnState(board),
		})

	case "log":
		if r.Method != http.MethodPost {
			http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
			return
		}
		var body struct {
			Message string `json:"message"`
		}
		if err := json.NewDecoder(r.Body).Decode(&body); err != nil || strings.TrimSpace(body.Message) == "" {
			w.WriteHeader(http.StatusBadRequest)
			writeJSON(w, map[string]bool{"ok": false})
			return
		}
		board.AddBotMessage(heroID, strings.TrimSpace(body.Message))
		snap := board.Snapshot(s.getTurnState(board))
		s.broadcastSnapshot(snap)
		writeJSON(w, map[string]bool{"ok": true})

	default:
		http.NotFound(w, r)
	}
}

func (s *Server) handleAdminStart(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
		return
	}

	board := s.mgr.ActiveBoard()
	if board == nil {
		board = s.mgr.EnsureOpenBoard()
	}

	if board.Lifecycle() == game.LifecycleRunning {
		snap := board.Snapshot(s.getTurnState(board))
		writeJSON(w, map[string]interface{}{"ok": true, "alreadyStarted": true, "snapshot": snap})
		return
	}
	if board.Lifecycle() == game.LifecycleCompleted {
		w.WriteHeader(http.StatusConflict)
		writeJSON(w, map[string]interface{}{"ok": false, "error": "board_completed"})
		return
	}

	board.SetLifecycle(game.LifecycleRunning)
	board.SetAutoStartAfter(time.Time{})
	board.SetCompletionReason("")
	board.AddSystemEvent("Board started by admin.")
	s.mgr.EnsureOpenBoard()
	s.startBeatLoop(board)
	snap := board.Snapshot(s.getTurnState(board))
	s.broadcastSnapshot(snap)
	s.emitLog(fmt.Sprintf("Board %s started!", board.ID))
	writeJSON(w, map[string]interface{}{"ok": true, "snapshot": snap})
}

func (s *Server) handleAdminStop(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
		return
	}

	board := s.mgr.ActiveBoard()
	if board == nil || board.Lifecycle() != game.LifecycleRunning {
		writeJSON(w, map[string]interface{}{"ok": true, "alreadyStopped": true})
		return
	}

	s.stopBeatLoop()
	s.mgr.CompleteBoard(board.ID, "Board stopped by admin.")
	snap := board.Snapshot(s.getTurnState(board))
	s.broadcastSnapshot(snap)
	s.emitLog("Board stopped by admin.")
	writeJSON(w, map[string]interface{}{"ok": true, "snapshot": snap})
}

func (s *Server) handleAdminReset(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
		return
	}

	board := s.mgr.ActiveBoard()
	if board != nil && board.Lifecycle() == game.LifecycleRunning {
		w.WriteHeader(http.StatusConflict)
		writeJSON(w, map[string]interface{}{"ok": false, "error": "board_running"})
		return
	}

	// Complete current board if open, and create fresh one
	if board != nil && board.Lifecycle() == game.LifecycleOpen {
		s.mgr.CompleteBoard(board.ID, "Board reset before start.")
	}
	newBoard := s.mgr.EnsureOpenBoard()
	snap := newBoard.Snapshot(s.getTurnState(newBoard))
	s.broadcastSnapshot(snap)
	s.emitLog(fmt.Sprintf("New board created: %s", newBoard.ID))
	writeJSON(w, map[string]interface{}{"ok": true, "boardId": newBoard.ID, "snapshot": snap})
}

func (s *Server) handleAdminSettings(w http.ResponseWriter, r *http.Request) {
	switch r.Method {
	case http.MethodGet:
		s.mu.RLock()
		settings := s.gameSettings
		s.mu.RUnlock()
		writeJSON(w, settings)

	case http.MethodPost:
		var incoming game.GameSettings
		if err := json.NewDecoder(r.Body).Decode(&incoming); err != nil {
			http.Error(w, "invalid json", http.StatusBadRequest)
			return
		}
		s.mu.Lock()
		wasPaused := s.gameSettings.Paused
		s.gameSettings = incoming
		s.mu.Unlock()

		// If just un-paused, resume the beat loop for the active board
		if wasPaused && !incoming.Paused {
			board := s.mgr.ActiveBoard()
			if board != nil && board.Lifecycle() == game.LifecycleRunning {
				s.startBeatLoop(board)
			}
		}

		s.emitLog(fmt.Sprintf("Game settings updated: landmarks=%v, playerPositions=%v, paused=%v", incoming.IncludeLandmarks, incoming.IncludePlayerPositions, incoming.Paused))
		writeJSON(w, map[string]interface{}{"ok": true, "settings": incoming})

	default:
		http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
	}
}

// ── Helpers ──

func writeJSON(w http.ResponseWriter, v interface{}) {
	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(v)
}

func envOr(key, fallback string) string {
	if v := os.Getenv(key); v != "" {
		return v
	}
	if v, ok := dotenvValue(key); ok && v != "" {
		return v
	}
	return fallback
}

func dotenvValue(key string) (string, bool) {
	dotenvOnce.Do(func() {
		dotenvVals = loadDotenvFiles([]string{".env", filepath.Join("..", ".env")})
	})
	v, ok := dotenvVals[key]
	return v, ok
}

func loadDotenvFiles(paths []string) map[string]string {
	values := make(map[string]string)
	for _, path := range paths {
		f, err := os.Open(path)
		if err != nil {
			continue
		}

		scanner := bufio.NewScanner(f)
		for scanner.Scan() {
			line := strings.TrimSpace(scanner.Text())
			if line == "" || strings.HasPrefix(line, "#") {
				continue
			}
			if strings.HasPrefix(line, "export ") {
				line = strings.TrimSpace(strings.TrimPrefix(line, "export "))
			}
			eq := strings.IndexByte(line, '=')
			if eq <= 0 {
				continue
			}
			k := strings.TrimSpace(line[:eq])
			v := strings.TrimSpace(line[eq+1:])
			v = strings.Trim(v, `"'`)
			if _, exists := values[k]; !exists {
				values[k] = v
			}
		}

		_ = f.Close()
	}
	return values
}

func withCORS(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Access-Control-Allow-Origin", "*")
		w.Header().Set("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
		w.Header().Set("Access-Control-Allow-Headers", "Content-Type")
		if r.Method == "OPTIONS" {
			w.WriteHeader(http.StatusNoContent)
			return
		}
		// Limit request body to 1MB to prevent abuse
		r.Body = http.MaxBytesReader(w, r.Body, 1<<20)
		next.ServeHTTP(w, r)
	})
}

func parseQueryInt(r *http.Request, key string, fallback int) int {
	if r == nil {
		return fallback
	}
	value := strings.TrimSpace(r.URL.Query().Get(key))
	if value == "" {
		return fallback
	}
	parsed, err := strconv.Atoi(value)
	if err != nil {
		return fallback
	}
	return parsed
}

func dirSuffix(d game.Direction) string {
	if d == "" {
		return ""
	}
	return " " + string(d)
}
