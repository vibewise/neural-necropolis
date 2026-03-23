package server

import (
	"bufio"
	"crypto/rand"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io/fs"
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
	mgr                *game.Manager
	arenas             *game.ArenaManager
	playerAuthToken    string
	adminAuthToken     string
	heroSessionLeaseMs int
	planningMs         int
	actionMs           int
	maxTurns           int
	port               int
	turnPhase          game.TurnPhase
	phaseStartAt       time.Time
	phaseEndAt         time.Time
	phaseTimer         *time.Timer
	mu                 sync.RWMutex
	streamClients      map[*sseClient]bool
	streamMu           sync.Mutex
	dashboardHTML      string
	gameSettings       game.GameSettings
	heroSessions       map[string]heroSession
	actionCache        map[string]cachedActionResponse
	arenaTurnStates    map[string]arenaTurnState
}

type arenaTurnState struct {
	Phase           game.TurnPhase
	PhaseStartAt    time.Time
	PhaseEndAt      time.Time
	SubmitWindowMs  int
	ResolveWindowMs int
	Started         bool
}

type heroSessionStatus string

const (
	heroSessionActive  heroSessionStatus = "active"
	heroSessionExpired heroSessionStatus = "expired"
)

type heroSession struct {
	Token          string
	BoardID        string
	LeaseExpiresAt time.Time
	LeaseTTL       time.Duration
	Status         heroSessionStatus
}

type expiredHeroSession struct {
	HeroID  string
	BoardID string
	Token   string
}

type cachedActionResponse struct {
	Accepted  bool
	Message   string
	TurnState game.TurnState
}

type sseClient struct {
	w       http.ResponseWriter
	flusher http.Flusher
	done    chan struct{}
}

type streamLogContext struct {
	ArenaID   string
	MatchID   string
	BoardID   string
	DuelIndex *int
}

func (ctx *streamLogContext) prefix() string {
	if ctx == nil {
		return ""
	}

	parts := make([]string, 0, 3)
	if arenaID := strings.TrimSpace(ctx.ArenaID); arenaID != "" {
		parts = append(parts, fmt.Sprintf("[arena:%s]", arenaID))
	}
	if matchID := strings.TrimSpace(ctx.MatchID); matchID != "" {
		parts = append(parts, fmt.Sprintf("[match:%s]", matchID))
	}
	if ctx.DuelIndex != nil {
		parts = append(parts, fmt.Sprintf("[duel:%d]", *ctx.DuelIndex))
	}

	return strings.Join(parts, "")
}

func (ctx *streamLogContext) format(message string) string {
	prefix := ctx.prefix()
	if prefix == "" {
		return message
	}
	return prefix + " " + message
}

var (
	dotenvOnce sync.Once
	dotenvVals map[string]string
)

const defaultDevPlayerAuthToken = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.neural-necropolis-dev-player.signature"
const defaultDevAdminAuthToken = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.neural-necropolis-dev-admin.signature"
const defaultHeroSessionLeaseMs = 30000
const minSubmitWindowMs = 250
const minResolveWindowMs = 50

func New() *Server {
	port, _ := strconv.Atoi(envOr("PORT", "3000"))
	planningMs, _ := strconv.Atoi(envOr("BEAT_PLANNING_MS", "12000"))
	actionMs, _ := strconv.Atoi(envOr("BEAT_ACTION_MS", "500"))
	if actionMs <= 0 {
		actionMs = 500
	}
	maxTurns, _ := strconv.Atoi(envOr("MAX_BOARD_TURNS", strconv.Itoa(game.CFG.MaxTurnsPerBoard)))
	heroSessionLeaseMs, _ := strconv.Atoi(envOr("HERO_SESSION_LEASE_MS", strconv.Itoa(defaultHeroSessionLeaseMs)))
	if heroSessionLeaseMs <= 0 {
		heroSessionLeaseMs = defaultHeroSessionLeaseMs
	}

	return &Server{
		mgr:                game.NewManager(),
		arenas:             game.NewArenaManager(),
		playerAuthToken:    resolvePlayerAuthToken(),
		adminAuthToken:     resolveAdminAuthToken(),
		heroSessionLeaseMs: heroSessionLeaseMs,
		planningMs:         planningMs,
		actionMs:           actionMs,
		maxTurns:           maxTurns,
		port:               port,
		turnPhase:          game.PhaseSubmit,
		phaseStartAt:       time.Now(),
		phaseEndAt:         time.Now().Add(time.Duration(planningMs) * time.Millisecond),
		streamClients:      make(map[*sseClient]bool),
		dashboardHTML:      DashboardHTML,
		gameSettings: game.GameSettings{
			Paused:          true,
			SubmitWindowMs:  planningMs,
			ResolveWindowMs: actionMs,
		},
		heroSessions:    make(map[string]heroSession),
		actionCache:     make(map[string]cachedActionResponse),
		arenaTurnStates: make(map[string]arenaTurnState),
	}
}

func (s *Server) Run() {
	s.mgr.EnsureOpenBoard()

	go s.autoStartLoop()
	go s.heroSessionLeaseLoop()

	handler := withCORS(s.routes())

	host := envOr("HOST", "127.0.0.1")
	addr := fmt.Sprintf("%s:%d", host, s.port)
	displayHost := host
	if host == "0.0.0.0" {
		displayHost = "localhost"
	}
	log.Printf("Neural Necropolis engine on http://%s:%d | submit=%s resolve=%s", displayHost, s.port, formatWindowMs(s.planningMs), formatWindowMs(s.actionMs))
	log.Printf("Neural Necropolis player auth active on hero routes%s", authModeSuffix(s.playerAuthToken, defaultDevPlayerAuthToken))
	log.Printf("Neural Necropolis admin auth active on admin routes%s", authModeSuffix(s.adminAuthToken, defaultDevAdminAuthToken))
	log.Fatal(http.ListenAndServe(addr, handler))
}

func (s *Server) routes() http.Handler {
	mux := http.NewServeMux()
	mux.Handle("/assets/", http.FileServer(http.FS(DashboardAppFS)))
	mux.HandleFunc("/legacy", s.handleLegacyDashboard)
	mux.HandleFunc("/legacy/", s.handleLegacyDashboard)
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
	mux.HandleFunc("/api/arena", s.handleArenaRoutes)
	mux.HandleFunc("/api/arena/", s.handleArenaRoutes)
	return mux
}

func authModeSuffix(token string, fallback string) string {
	if token == fallback {
		return " (default dev token)"
	}
	return ""
}

func resolvePlayerAuthToken() string {
	shared := envOr("NEURAL_NECROPOLIS_AUTH_TOKEN", "")
	if token := envOr("NEURAL_NECROPOLIS_PLAYER_TOKEN", ""); token != "" {
		return token
	}
	if shared != "" {
		return shared
	}
	return defaultDevPlayerAuthToken
}

func resolveAdminAuthToken() string {
	shared := envOr("NEURAL_NECROPOLIS_AUTH_TOKEN", "")
	if token := envOr("NEURAL_NECROPOLIS_ADMIN_TOKEN", ""); token != "" {
		return token
	}
	if shared != "" {
		return shared
	}
	return defaultDevAdminAuthToken
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

func normalizeWindowMs(value int, fallback int, minimum int) int {
	if value < minimum {
		return fallback
	}
	return value
}

func (s *Server) currentGameSettingsLocked() game.GameSettings {
	settings := s.gameSettings
	settings.SubmitWindowMs = normalizeWindowMs(settings.SubmitWindowMs, s.planningMs, minSubmitWindowMs)
	settings.ResolveWindowMs = normalizeWindowMs(settings.ResolveWindowMs, s.actionMs, minResolveWindowMs)
	return settings
}

func (s *Server) autoStartLoop() {
	ticker := time.NewTicker(250 * time.Millisecond)
	defer ticker.Stop()
	for range ticker.C {
		s.mu.RLock()
		paused := s.currentGameSettingsLocked().Paused
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

func (s *Server) heroSessionLeaseLoop() {
	ticker := time.NewTicker(500 * time.Millisecond)
	defer ticker.Stop()
	for now := range ticker.C {
		s.expireHeroSessions(now)
	}
}

func (s *Server) newHeroSession(boardID string, now time.Time) heroSession {
	leaseTTL := time.Duration(s.heroSessionLeaseMs) * time.Millisecond
	return heroSession{
		Token:          randomToken(16),
		BoardID:        boardID,
		LeaseExpiresAt: now.Add(leaseTTL),
		LeaseTTL:       leaseTTL,
		Status:         heroSessionActive,
	}
}

func (s *Server) renewHeroSession(heroID string, now time.Time) (heroSession, bool) {
	s.mu.Lock()
	defer s.mu.Unlock()
	session, ok := s.heroSessions[heroID]
	if !ok || session.Status != heroSessionActive {
		return heroSession{}, false
	}
	session.LeaseExpiresAt = now.Add(session.LeaseTTL)
	s.heroSessions[heroID] = session
	return session, true
}

func (s *Server) markHeroSessionExpired(heroID string) (expiredHeroSession, bool) {
	s.mu.Lock()
	defer s.mu.Unlock()
	session, ok := s.heroSessions[heroID]
	if !ok || session.Status == heroSessionExpired {
		return expiredHeroSession{}, false
	}
	session.Status = heroSessionExpired
	s.heroSessions[heroID] = session
	return expiredHeroSession{HeroID: heroID, BoardID: session.BoardID, Token: session.Token}, true
}

func (s *Server) expireHeroSessions(now time.Time) {
	var expired []expiredHeroSession

	s.mu.Lock()
	for heroID, session := range s.heroSessions {
		if session.Status != heroSessionActive {
			continue
		}
		if !session.LeaseExpiresAt.IsZero() && !now.Before(session.LeaseExpiresAt) {
			session.Status = heroSessionExpired
			s.heroSessions[heroID] = session
			expired = append(expired, expiredHeroSession{HeroID: heroID, BoardID: session.BoardID, Token: session.Token})
		}
	}
	s.mu.Unlock()

	for _, session := range expired {
		s.handleExpiredHeroSession(session)
	}
}

func (s *Server) handleExpiredHeroSession(expired expiredHeroSession) {
	s.mu.RLock()
	current, ok := s.heroSessions[expired.HeroID]
	s.mu.RUnlock()
	if !ok || current.Token != expired.Token || current.Status != heroSessionExpired {
		return
	}

	board := s.mgr.GetBoard(expired.BoardID)
	if board == nil {
		return
	}

	switch board.Lifecycle() {
	case game.LifecycleOpen:
		heroName, removed := board.RemoveHeroIfOpen(expired.HeroID, time.Now())
		if !removed {
			return
		}
		board.AddSystemEvent(fmt.Sprintf("%s lost connection before the board started and was removed from the queue.", heroName))
		s.broadcastSnapshot(board.Snapshot(s.getTurnState(board)))
		s.emitLog(fmt.Sprintf("%s session expired on %s and the hero was removed from the open board.", heroName, board.ID))
	case game.LifecycleRunning:
		heroName, changed := board.MarkHeroDisconnected(expired.HeroID)
		if !changed {
			return
		}
		board.AddSystemEvent(fmt.Sprintf("%s lost connection and can no longer act on this board.", heroName))
		s.broadcastSnapshot(board.Snapshot(s.getTurnState(board)))
		s.emitLog(fmt.Sprintf("%s session expired on %s and is now inactive for the rest of the board.", heroName, board.ID))
	}
}

func heroSessionLeasePayload(session heroSession) map[string]interface{} {
	return map[string]interface{}{
		"leaseExpiresAt": session.LeaseExpiresAt.UnixMilli(),
		"leaseTtlMs":     session.LeaseTTL.Milliseconds(),
		"sessionStatus":  string(session.Status),
	}
}

func (s *Server) tryAutoStartBoard() (*game.Board, bool) {
	s.mu.RLock()
	paused := s.currentGameSettingsLocked().Paused
	s.mu.RUnlock()
	if paused {
		return nil, false
	}
	return s.mgr.TryAutoStart()
}

// ── Turn phase state machine ──

func (s *Server) getTurnState(board *game.Board) game.TurnState {
	if board != nil {
		s.mu.RLock()
		arenaState, ok := s.arenaTurnStates[board.ID]
		s.mu.RUnlock()
		if ok {
			now := time.Now()
			return game.TurnState{
				Turn:            board.Turn(),
				Phase:           arenaState.Phase,
				Started:         arenaState.Started,
				SubmitWindowMs:  int64(arenaState.SubmitWindowMs),
				ResolveWindowMs: int64(arenaState.ResolveWindowMs),
				PhaseEndsAt:     arenaState.PhaseEndAt.UnixMilli(),
				PhaseDurationMs: arenaState.PhaseEndAt.Sub(arenaState.PhaseStartAt).Milliseconds(),
				PhaseElapsedMs:  now.Sub(arenaState.PhaseStartAt).Milliseconds(),
				Seed:            board.Seed(),
			}
		}
	}

	s.mu.RLock()
	defer s.mu.RUnlock()
	now := time.Now()
	seed := ""
	turn := 0
	if board != nil {
		seed = board.Seed()
		turn = board.Turn()
	}
	return game.TurnState{
		Turn:            turn,
		Phase:           s.turnPhase,
		Started:         board != nil && board.Lifecycle() == game.LifecycleRunning,
		SubmitWindowMs:  int64(s.planningMs),
		ResolveWindowMs: int64(s.actionMs),
		PhaseEndsAt:     s.phaseEndAt.UnixMilli(),
		PhaseDurationMs: s.phaseEndAt.Sub(s.phaseStartAt).Milliseconds(),
		PhaseElapsedMs:  now.Sub(s.phaseStartAt).Milliseconds(),
		Seed:            seed,
	}
}

func (s *Server) setArenaTurnState(boardID string, state arenaTurnState) {
	s.mu.Lock()
	defer s.mu.Unlock()
	if s.arenaTurnStates == nil {
		s.arenaTurnStates = make(map[string]arenaTurnState)
	}
	s.arenaTurnStates[boardID] = state
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
	prevLastEventID := board.LastEventID()
	board.StepWorld()
	s.emitBoardEvents(board, &streamLogContext{BoardID: board.ID}, prevLastEventID)

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
	settings := s.currentGameSettingsLocked()
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

func (s *Server) emitContextLog(ctx *streamLogContext, message string) {
	formatted := message
	if ctx != nil {
		formatted = ctx.format(message)
	}
	log.Printf("%s", formatted)
	s.broadcast("log", formatted)
}

func (s *Server) emitLog(message string) {
	s.emitContextLog(nil, message)
}

func (s *Server) emitBoardEvents(board *game.Board, ctx *streamLogContext, previousLastEventID string) {
	for _, event := range board.EventsAfterID(previousLastEventID) {
		s.emitContextLog(ctx, fmt.Sprintf("[%s] %s", strings.ToUpper(string(event.Type)), event.Summary))
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
	content, err := fs.ReadFile(DashboardAppFS, "index.html")
	if err != nil {
		fmt.Fprint(w, s.dashboardHTML)
		return
	}
	w.Write(content)
}

func (s *Server) handleLegacyDashboard(w http.ResponseWriter, r *http.Request) {
	if r.URL.Path != "/legacy" && r.URL.Path != "/legacy/" {
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
	settings := s.currentGameSettingsLocked()
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
	s.mu.RLock()
	settings := s.gameSettings
	s.mu.RUnlock()
	raw, _ := json.Marshal(snap)
	var combined map[string]interface{}
	json.Unmarshal(raw, &combined)
	combined["gameSettings"] = settings
	data, _ := json.Marshal(combined)
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
	requestID := s.prepareRequestID(w, r)
	if !s.requirePlayerAuth(w, r, requestID) {
		return
	}
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
				"requestId": requestID,
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
	now := time.Now()
	session := s.newHeroSession(board.ID, now)
	s.mu.Lock()
	s.heroSessions[string(hero.ID)] = session
	s.mu.Unlock()

	// Auto-start check
	if started, ok := s.tryAutoStartBoard(); ok {
		s.startBeatLoop(started)
		snap = started.Snapshot(s.getTurnState(started))
		s.broadcastSnapshot(snap)
		s.emitLog(fmt.Sprintf("Board %s auto-started!", started.ID))
	}

	resp := map[string]interface{}{
		"id":           hero.ID,
		"name":         hero.Name,
		"trait":        hero.Trait,
		"strategy":     hero.Strategy,
		"stats":        hero.Stats,
		"position":     hero.Position,
		"boardId":      board.ID,
		"sessionToken": session.Token,
		"requestId":    requestID,
		"turnState":    s.getTurnState(board),
	}
	for key, value := range heroSessionLeasePayload(session) {
		resp[key] = value
	}
	writeJSON(w, resp)
}

func (s *Server) handleHeroRoutes(w http.ResponseWriter, r *http.Request) {
	requestID := s.prepareRequestID(w, r)
	if !s.requirePlayerAuth(w, r, requestID) {
		return
	}
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
	if !s.requireHeroSession(w, r, heroID, board.ID, requestID) {
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
		if vision.SpellDiscoveries != nil {
			resp["spellDiscoveries"] = vision.SpellDiscoveries
		}
		resp["requestId"] = requestID
		resp["gameSettings"] = settings
		if session, ok := s.renewHeroSession(heroID, time.Now()); ok {
			for key, value := range heroSessionLeasePayload(session) {
				resp[key] = value
			}
		}
		writeJSON(w, resp)

	case "heartbeat":
		if r.Method != http.MethodPost {
			http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
			return
		}
		session, ok := s.renewHeroSession(heroID, time.Now())
		if !ok {
			w.WriteHeader(http.StatusUnauthorized)
			writeJSON(w, map[string]interface{}{
				"ok":        false,
				"error":     "expired_session",
				"requestId": requestID,
				"message":   "Hero session expired. Re-register for an open board.",
			})
			return
		}
		resp := map[string]interface{}{
			"ok":        true,
			"boardId":   board.ID,
			"requestId": requestID,
			"turnState": s.getTurnState(board),
		}
		for key, value := range heroSessionLeasePayload(session) {
			resp[key] = value
		}
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
				"requestId": requestID,
				"turnState": s.getTurnState(board),
			})
			return
		}

		var heroAction game.HeroAction
		if err := json.NewDecoder(r.Body).Decode(&heroAction); err != nil {
			http.Error(w, "invalid json", http.StatusBadRequest)
			return
		}

		idempotencyKey := strings.TrimSpace(r.Header.Get("Idempotency-Key"))
		turn := board.Turn()
		if idempotencyKey != "" {
			if cached, ok := s.lookupActionCache(heroID, board.ID, turn, idempotencyKey); ok {
				writeJSON(w, map[string]interface{}{
					"accepted":  cached.Accepted,
					"message":   cached.Message,
					"requestId": requestID,
					"replayed":  true,
					"turnState": cached.TurnState,
				})
				return
			}
		}

		accepted, msg := board.SubmitAction(heroID, heroAction)
		turnState := s.getTurnState(board)
		if idempotencyKey != "" {
			s.storeActionCache(heroID, board.ID, turn, idempotencyKey, cachedActionResponse{
				Accepted:  accepted,
				Message:   msg,
				TurnState: turnState,
			})
		}
		if accepted {
			s.emitLog(fmt.Sprintf("%s → %s%s", heroID, heroAction.Kind, dirSuffix(heroAction.Direction)))
		} else {
			s.emitLog(fmt.Sprintf("%s rejected action %s%s: %s", heroID, heroAction.Kind, dirSuffix(heroAction.Direction), msg))
		}
		_, _ = s.renewHeroSession(heroID, time.Now())
		writeJSON(w, map[string]interface{}{
			"accepted":  accepted,
			"message":   msg,
			"requestId": requestID,
			"turnState": turnState,
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
			writeJSON(w, map[string]interface{}{"ok": false, "requestId": requestID})
			return
		}
		board.AddBotMessage(heroID, strings.TrimSpace(body.Message))
		snap := board.Snapshot(s.getTurnState(board))
		s.broadcastSnapshot(snap)
		_, _ = s.renewHeroSession(heroID, time.Now())
		writeJSON(w, map[string]interface{}{"ok": true, "requestId": requestID})

	default:
		http.NotFound(w, r)
	}
}

func (s *Server) handleAdminStart(w http.ResponseWriter, r *http.Request) {
	requestID := s.prepareRequestID(w, r)
	if !s.requireAdminAuth(w, r, requestID) {
		return
	}
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

	s.mu.RLock()
	paused := s.gameSettings.Paused
	s.mu.RUnlock()
	if paused {
		w.WriteHeader(http.StatusConflict)
		writeJSON(w, map[string]interface{}{
			"ok":       false,
			"error":    "game_paused",
			"message":  "Game is paused. Resume before starting a board.",
			"snapshot": board.Snapshot(s.getTurnState(board)),
		})
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
	requestID := s.prepareRequestID(w, r)
	if !s.requireAdminAuth(w, r, requestID) {
		return
	}
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
	requestID := s.prepareRequestID(w, r)
	if !s.requireAdminAuth(w, r, requestID) {
		return
	}
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
	requestID := s.prepareRequestID(w, r)
	if !s.requireAdminAuth(w, r, requestID) {
		return
	}
	switch r.Method {
	case http.MethodGet:
		s.mu.RLock()
		settings := s.currentGameSettingsLocked()
		s.mu.RUnlock()
		writeJSON(w, settings)

	case http.MethodPost:
		var incoming game.GameSettings
		if err := json.NewDecoder(r.Body).Decode(&incoming); err != nil {
			http.Error(w, "invalid json", http.StatusBadRequest)
			return
		}
		s.mu.Lock()
		current := s.currentGameSettingsLocked()
		wasPaused := current.Paused
		wasPlanningMs := s.planningMs
		wasActionMs := s.actionMs
		phase := s.turnPhase
		merged := current
		merged.Paused = incoming.Paused
		merged.SubmitWindowMs = normalizeWindowMs(incoming.SubmitWindowMs, current.SubmitWindowMs, minSubmitWindowMs)
		merged.ResolveWindowMs = normalizeWindowMs(incoming.ResolveWindowMs, current.ResolveWindowMs, minResolveWindowMs)
		timingChanged := merged.SubmitWindowMs != wasPlanningMs || merged.ResolveWindowMs != wasActionMs
		s.planningMs = merged.SubmitWindowMs
		s.actionMs = merged.ResolveWindowMs
		s.gameSettings = merged
		s.mu.Unlock()

		board := s.mgr.ActiveBoard()
		if !wasPaused && merged.Paused {
			s.stopBeatLoop()
		}
		if board != nil && board.Lifecycle() == game.LifecycleRunning {
			if wasPaused && !merged.Paused {
				s.startBeatLoop(board)
			} else if timingChanged && !merged.Paused && phase == game.PhaseSubmit {
				s.startBeatLoop(board)
			}
		}

		s.emitLog(fmt.Sprintf("Game settings updated: paused=%v, submit=%s, resolve=%s", merged.Paused, formatWindowMs(merged.SubmitWindowMs), formatWindowMs(merged.ResolveWindowMs)))
		writeJSON(w, map[string]interface{}{"ok": true, "settings": merged})

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

func (s *Server) requirePlayerAuth(w http.ResponseWriter, r *http.Request, requestID string) bool {
	return s.requireBearerToken(w, r, requestID, s.playerAuthToken)
}

func (s *Server) requireAdminAuth(w http.ResponseWriter, r *http.Request, requestID string) bool {
	return s.requireBearerToken(w, r, requestID, s.adminAuthToken)
}

func (s *Server) requireBearerToken(w http.ResponseWriter, r *http.Request, requestID string, expected string) bool {
	if r == nil {
		w.WriteHeader(http.StatusUnauthorized)
		writeJSON(w, map[string]interface{}{
			"ok":        false,
			"error":     "missing_auth",
			"requestId": requestID,
			"message":   "Missing bearer token.",
		})
		return false
	}
	token := strings.TrimSpace(strings.TrimPrefix(r.Header.Get("Authorization"), "Bearer "))
	if token == expected {
		return true
	}
	status := http.StatusUnauthorized
	errorCode := "missing_auth"
	message := "Missing bearer token."
	if token != "" {
		errorCode = "invalid_auth"
		message = "Invalid bearer token."
	}
	w.WriteHeader(status)
	writeJSON(w, map[string]interface{}{
		"ok":        false,
		"error":     errorCode,
		"requestId": requestID,
		"message":   message,
	})
	return false
}

func (s *Server) requireHeroSession(w http.ResponseWriter, r *http.Request, heroID string, boardID string, requestID string) bool {
	s.mu.RLock()
	session, ok := s.heroSessions[heroID]
	s.mu.RUnlock()
	if !ok || session.BoardID != boardID {
		w.WriteHeader(http.StatusUnauthorized)
		writeJSON(w, map[string]interface{}{
			"ok":        false,
			"error":     "invalid_session",
			"requestId": requestID,
			"message":   "Unknown hero session.",
		})
		return false
	}
	provided := strings.TrimSpace(r.Header.Get("X-Hero-Session-Token"))
	if provided == session.Token {
		if session.Status == heroSessionExpired || (!session.LeaseExpiresAt.IsZero() && !time.Now().Before(session.LeaseExpiresAt)) {
			if expired, ok := s.markHeroSessionExpired(heroID); ok {
				s.handleExpiredHeroSession(expired)
			}
			w.WriteHeader(http.StatusUnauthorized)
			writeJSON(w, map[string]interface{}{
				"ok":        false,
				"error":     "expired_session",
				"requestId": requestID,
				"message":   "Hero session expired. Re-register for an open board.",
			})
			return false
		}
		return true
	}
	errorCode := "missing_session"
	message := "Missing hero session token."
	if provided != "" {
		errorCode = "invalid_session"
		message = "Invalid hero session token."
	}
	w.WriteHeader(http.StatusUnauthorized)
	writeJSON(w, map[string]interface{}{
		"ok":        false,
		"error":     errorCode,
		"requestId": requestID,
		"message":   message,
	})
	return false
}

func (s *Server) prepareRequestID(w http.ResponseWriter, r *http.Request) string {
	requestID := strings.TrimSpace(r.Header.Get("X-Request-Id"))
	if requestID == "" {
		requestID = randomToken(8)
	}
	w.Header().Set("X-Request-Id", requestID)
	return requestID
}

func (s *Server) lookupActionCache(heroID string, boardID string, turn int, key string) (cachedActionResponse, bool) {
	s.mu.RLock()
	defer s.mu.RUnlock()
	value, ok := s.actionCache[actionCacheKey(heroID, boardID, turn, key)]
	return value, ok
}

func (s *Server) storeActionCache(heroID string, boardID string, turn int, key string, response cachedActionResponse) {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.actionCache[actionCacheKey(heroID, boardID, turn, key)] = response
}

func actionCacheKey(heroID string, boardID string, turn int, key string) string {
	return fmt.Sprintf("%s|%s|%d|%s", heroID, boardID, turn, key)
}

func randomToken(byteLength int) string {
	buf := make([]byte, byteLength)
	if _, err := rand.Read(buf); err != nil {
		return fmt.Sprintf("fallback-%d", time.Now().UnixNano())
	}
	return hex.EncodeToString(buf)
}

func withCORS(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Access-Control-Allow-Origin", "*")
		w.Header().Set("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
		w.Header().Set("Access-Control-Allow-Headers", "Accept, Authorization, Content-Type, Idempotency-Key, Last-Event-ID, X-Hero-Session-Token, X-Request-Id")
		w.Header().Set("Access-Control-Expose-Headers", "X-Request-Id")
		w.Header().Set("Access-Control-Max-Age", "600")
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
