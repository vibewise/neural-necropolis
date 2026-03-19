package server

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/mmorph/engine/game"
)

type registerResponse struct {
	ID        string         `json:"id"`
	Name      string         `json:"name"`
	Trait     game.HeroTrait `json:"trait"`
	Strategy  string         `json:"strategy"`
	Stats     game.HeroStats `json:"stats"`
	Position  game.Position  `json:"position"`
	BoardID   string         `json:"boardId"`
	TurnState game.TurnState `json:"turnState"`
}

type observeResponse struct {
	Seed            string              `json:"seed"`
	Turn            int                 `json:"turn"`
	BoardID         string              `json:"boardId"`
	BoardStatus     game.BoardLifecycle `json:"boardStatus"`
	Hero            *game.HeroProfile   `json:"hero"`
	VisibleTiles    []game.VisionTile   `json:"visibleTiles"`
	VisibleMonsters []game.Monster      `json:"visibleMonsters"`
	VisibleHeroes   []game.HeroProfile  `json:"visibleHeroes"`
	VisibleNpcs     []game.Npc          `json:"visibleNpcs"`
	VisibleItems    []game.FloorItem    `json:"visibleItems"`
	RecentEvents    []game.EventRecord  `json:"recentEvents"`
	LegalActions    []game.LegalAction  `json:"legalActions"`
	TurnState       game.TurnState      `json:"turnState"`
}

type actionResponse struct {
	Accepted  bool           `json:"accepted"`
	Message   string         `json:"message"`
	Error     string         `json:"error"`
	TurnState game.TurnState `json:"turnState"`
}

type logResponse struct {
	OK bool `json:"ok"`
}

type healthResponse struct {
	OK        bool           `json:"ok"`
	TurnState game.TurnState `json:"turnState"`
}

type seedResponse struct {
	Seed string `json:"seed"`
}

type leaderboardResponse struct {
	Leaderboard []game.ScoreTrack `json:"leaderboard"`
}

type completedBoardsResponse struct {
	Boards []struct {
		BoardID          string            `json:"boardId"`
		BoardSlug        string            `json:"boardSlug"`
		BoardName        string            `json:"boardName"`
		Turn             int               `json:"turn"`
		CompletionReason string            `json:"completionReason"`
		Seed             string            `json:"seed"`
		HeroCount        int               `json:"heroCount"`
		MonsterCount     int               `json:"monsterCount"`
		TopLeaderboard   []game.ScoreTrack `json:"topLeaderboard"`
	} `json:"boards"`
	Total  int `json:"total"`
	Offset int `json:"offset"`
	Limit  int `json:"limit"`
}

type adminSnapshotResponse struct {
	OK             bool               `json:"ok"`
	AlreadyStarted bool               `json:"alreadyStarted"`
	AlreadyStopped bool               `json:"alreadyStopped"`
	Error          string             `json:"error"`
	BoardID        string             `json:"boardId"`
	Snapshot       game.BoardSnapshot `json:"snapshot"`
}

func newHTTPTestServer() *Server {
	return &Server{
		mgr:           game.NewManager(),
		planningMs:    12000,
		actionMs:      500,
		warmupMs:      0,
		maxTurns:      game.CFG.MaxTurnsPerBoard,
		turnPhase:     game.PhaseSubmit,
		phaseStartAt:  time.Now(),
		phaseEndAt:    time.Now().Add(12 * time.Second),
		streamClients: make(map[*sseClient]bool),
		dashboardHTML: "<html><body>dashboard</body></html>",
	}
}

func performRequest(t *testing.T, handler http.HandlerFunc, method string, target string, body string) *httptest.ResponseRecorder {
	t.Helper()
	req := httptest.NewRequest(method, target, bytes.NewBufferString(body))
	if body != "" {
		req.Header.Set("Content-Type", "application/json")
	}
	rec := httptest.NewRecorder()
	handler(rec, req)
	return rec
}

func decodeJSONMap(t *testing.T, rec *httptest.ResponseRecorder) map[string]interface{} {
	t.Helper()
	var payload map[string]interface{}
	if err := json.Unmarshal(rec.Body.Bytes(), &payload); err != nil {
		t.Fatalf("decode json response: %v\nbody=%s", err, rec.Body.String())
	}
	return payload
}

func decodeJSONInto[T any](t *testing.T, rec *httptest.ResponseRecorder) T {
	t.Helper()
	var payload T
	if err := json.Unmarshal(rec.Body.Bytes(), &payload); err != nil {
		t.Fatalf("decode typed json response: %v\nbody=%s", err, rec.Body.String())
	}
	return payload
}

func registerHTTPTestHero(t *testing.T, s *Server, id string) map[string]interface{} {
	t.Helper()
	body := fmt.Sprintf(`{"id":"%s","name":"%s","strategy":"test strategy","preferredTrait":"curious"}`, id, strings.ToUpper(id[:1])+id[1:])
	rec := performRequest(t, s.handleRegister, http.MethodPost, "/api/heroes/register", body)
	if rec.Code != http.StatusOK {
		t.Fatalf("register hero status = %d, want 200; body=%s", rec.Code, rec.Body.String())
	}
	return decodeJSONMap(t, rec)
}

func TestPublicAPIRegisterObserveActAndLogRoutes(t *testing.T) {
	s := newHTTPTestServer()
	reg := registerHTTPTestHero(t, s, "hero-http")
	if reg["id"] != "hero-http" {
		t.Fatalf("register id = %v, want hero-http", reg["id"])
	}
	if reg["boardId"] == "" {
		t.Fatalf("register response missing boardId")
	}
	if reg["trait"] != string(game.TraitCurious) {
		t.Fatalf("register trait = %v, want %s", reg["trait"], game.TraitCurious)
	}
	if _, ok := reg["turnState"].(map[string]interface{}); !ok {
		t.Fatalf("register response missing turnState object: %T", reg["turnState"])
	}

	observe := performRequest(t, s.handleHeroRoutes, http.MethodGet, "/api/heroes/hero-http/observe", "")
	if observe.Code != http.StatusOK {
		t.Fatalf("observe status = %d, want 200; body=%s", observe.Code, observe.Body.String())
	}
	observePayload := decodeJSONMap(t, observe)
	for _, key := range []string{"seed", "turn", "boardId", "boardStatus", "hero", "visibleTiles", "visibleMonsters", "visibleHeroes", "visibleNpcs", "visibleItems", "recentEvents", "legalActions", "turnState"} {
		if _, ok := observePayload[key]; !ok {
			t.Fatalf("observe response missing key %q", key)
		}
	}

	act := performRequest(t, s.handleHeroRoutes, http.MethodPost, "/api/heroes/hero-http/act", `{"kind":"wait"}`)
	if act.Code != http.StatusOK {
		t.Fatalf("act status = %d, want 200; body=%s", act.Code, act.Body.String())
	}
	actPayload := decodeJSONMap(t, act)
	if accepted, ok := actPayload["accepted"].(bool); !ok || !accepted {
		t.Fatalf("act accepted = %v, want true", actPayload["accepted"])
	}

	rejected := performRequest(t, s.handleHeroRoutes, http.MethodPost, "/api/heroes/hero-http/act", `{"kind":"wait"}`)
	if rejected.Code != http.StatusOK {
		t.Fatalf("duplicate act status = %d, want 200; body=%s", rejected.Code, rejected.Body.String())
	}
	rejectedPayload := decodeJSONMap(t, rejected)
	if accepted, ok := rejectedPayload["accepted"].(bool); !ok || accepted {
		t.Fatalf("duplicate act accepted = %v, want false", rejectedPayload["accepted"])
	}
	message, _ := rejectedPayload["message"].(string)
	if !strings.Contains(message, "action already queued for turn") {
		t.Fatalf("duplicate act message = %q, want queue rejection", message)
	}

	logResp := performRequest(t, s.handleHeroRoutes, http.MethodPost, "/api/heroes/hero-http/log", `{"message":"moving north next turn"}`)
	if logResp.Code != http.StatusOK {
		t.Fatalf("log status = %d, want 200; body=%s", logResp.Code, logResp.Body.String())
	}
	logPayload := decodeJSONMap(t, logResp)
	if ok, _ := logPayload["ok"].(bool); !ok {
		t.Fatalf("log ok = %v, want true", logPayload["ok"])
	}

	badLog := performRequest(t, s.handleHeroRoutes, http.MethodPost, "/api/heroes/hero-http/log", `{"message":"   "}`)
	if badLog.Code != http.StatusBadRequest {
		t.Fatalf("blank log status = %d, want 400; body=%s", badLog.Code, badLog.Body.String())
	}
}

func TestPublicAPIActRouteRejectsWrongPhase(t *testing.T) {
	s := newHTTPTestServer()
	registerHTTPTestHero(t, s, "hero-phase")
	s.turnPhase = game.PhaseResolve

	rec := performRequest(t, s.handleHeroRoutes, http.MethodPost, "/api/heroes/hero-phase/act", `{"kind":"wait"}`)
	if rec.Code != http.StatusConflict {
		t.Fatalf("wrong-phase act status = %d, want 409; body=%s", rec.Code, rec.Body.String())
	}
	payload := decodeJSONMap(t, rec)
	if payload["error"] != "wrong_phase" {
		t.Fatalf("wrong-phase error = %v, want wrong_phase", payload["error"])
	}
	message, _ := payload["message"].(string)
	if !strings.Contains(message, string(game.PhaseResolve)) {
		t.Fatalf("wrong-phase message = %q, want current phase", message)
	}
}

func TestPublicAPIBoardSummarySeedAndLeaderboardRoutes(t *testing.T) {
	s := newHTTPTestServer()
	registerHTTPTestHero(t, s, "hero-board")
	board := s.mgr.ActiveBoard()
	state := boardStateForTest(board)
	state.Heroes[0].Score = 42
	state.Heroes[0].TilesExplored = 15
	state.Heroes[0].TurnsSurvived = 6

	health := performRequest(t, s.handleHealth, http.MethodGet, "/api/health", "")
	if health.Code != http.StatusOK {
		t.Fatalf("health status = %d, want 200", health.Code)
	}
	healthPayload := decodeJSONMap(t, health)
	if ok, _ := healthPayload["ok"].(bool); !ok {
		t.Fatalf("health ok = %v, want true", healthPayload["ok"])
	}
	if _, ok := healthPayload["turnState"].(map[string]interface{}); !ok {
		t.Fatalf("health response missing turnState object")
	}

	dashboard := performRequest(t, s.handleDashboardAPI, http.MethodGet, "/api/dashboard", "")
	if dashboard.Code != http.StatusOK {
		t.Fatalf("dashboard status = %d, want 200", dashboard.Code)
	}
	dashboardPayload := decodeJSONMap(t, dashboard)
	for _, key := range []string{"boardId", "seed", "heroes", "world", "leaderboard", "lobby"} {
		if _, ok := dashboardPayload[key]; !ok {
			t.Fatalf("dashboard response missing key %q", key)
		}
	}

	boards := performRequest(t, s.handleBoards, http.MethodGet, "/api/boards", "")
	if boards.Code != http.StatusOK {
		t.Fatalf("boards status = %d, want 200", boards.Code)
	}
	boardsPayload := decodeJSONMap(t, boards)
	boardsList, ok := boardsPayload["boards"].([]interface{})
	if !ok {
		t.Fatalf("boards response missing boards list")
	}
	if len(boardsList) == 0 {
		t.Fatalf("boards response returned empty board list")
	}
	firstBoard, ok := boardsList[0].(map[string]interface{})
	if !ok {
		t.Fatalf("boards entry = %T, want object", boardsList[0])
	}
	for _, key := range []string{"boardId", "boardSlug", "boardName", "status", "queueStatus", "heroCount", "maxHeroes", "turn", "seed"} {
		if _, ok := firstBoard[key]; !ok {
			t.Fatalf("boards entry missing key %q", key)
		}
	}

	seed := performRequest(t, s.handleSeed, http.MethodGet, "/api/seed", "")
	if seed.Code != http.StatusOK {
		t.Fatalf("seed status = %d, want 200", seed.Code)
	}
	seedPayload := decodeJSONMap(t, seed)
	if seedPayload["seed"] != board.Seed() {
		t.Fatalf("seed payload = %v, want %s", seedPayload["seed"], board.Seed())
	}

	leaderboard := performRequest(t, s.handleLeaderboard, http.MethodGet, "/api/leaderboard", "")
	if leaderboard.Code != http.StatusOK {
		t.Fatalf("leaderboard status = %d, want 200", leaderboard.Code)
	}
	leaderboardPayload := decodeJSONMap(t, leaderboard)
	entries, ok := leaderboardPayload["leaderboard"].([]interface{})
	if !ok || len(entries) == 0 {
		t.Fatalf("leaderboard entries = %T %v, want non-empty list", leaderboardPayload["leaderboard"], leaderboardPayload["leaderboard"])
	}
}

func TestPublicAPICompletedBoardsRoutePaginatesCompletedHistory(t *testing.T) {
	s := newHTTPTestServer()
	boardOne, _, err := s.mgr.RegisterHero(game.HeroRegistration{ID: "hero-completed-1", Name: "CompletedOne", Strategy: "test"})
	if err != nil {
		t.Fatalf("register first completed hero: %v", err)
	}
	s.mgr.CompleteBoard(boardOne.ID, "Board one complete.")
	boardTwo, _, err := s.mgr.RegisterHero(game.HeroRegistration{ID: "hero-completed-2", Name: "CompletedTwo", Strategy: "test"})
	if err != nil {
		t.Fatalf("register second completed hero: %v", err)
	}
	s.mgr.CompleteBoard(boardTwo.ID, "Board two complete.")

	rec := performRequest(t, s.handleCompletedBoards, http.MethodGet, "/api/boards/completed?offset=0&limit=1", "")
	if rec.Code != http.StatusOK {
		t.Fatalf("completed boards status = %d, want 200; body=%s", rec.Code, rec.Body.String())
	}
	payload := decodeJSONMap(t, rec)
	if payload["total"] == nil {
		t.Fatalf("completed boards response missing total")
	}
	if got := int(payload["offset"].(float64)); got != 0 {
		t.Fatalf("offset = %d, want 0", got)
	}
	if got := int(payload["limit"].(float64)); got != 1 {
		t.Fatalf("limit = %d, want 1", got)
	}
	boards, ok := payload["boards"].([]interface{})
	if !ok || len(boards) != 1 {
		t.Fatalf("completed boards = %T %v, want exactly one result", payload["boards"], payload["boards"])
	}
	entry, ok := boards[0].(map[string]interface{})
	if !ok {
		t.Fatalf("completed board entry = %T, want object", boards[0])
	}
	for _, key := range []string{"boardId", "boardSlug", "boardName", "turn", "completionReason", "seed", "heroCount", "monsterCount", "topLeaderboard"} {
		if _, ok := entry[key]; !ok {
			t.Fatalf("completed board entry missing key %q", key)
		}
	}
}

func TestPublicAPIStreamRouteEmitsSnapshotEvent(t *testing.T) {
	s := newHTTPTestServer()
	registerHTTPTestHero(t, s, "hero-stream")

	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	req := httptest.NewRequest(http.MethodGet, "/api/stream", nil).WithContext(ctx)
	rec := httptest.NewRecorder()

	done := make(chan struct{})
	go func() {
		s.handleStream(rec, req)
		close(done)
	}()

	time.Sleep(20 * time.Millisecond)
	cancel()

	select {
	case <-done:
	case <-time.After(250 * time.Millisecond):
		t.Fatal("stream handler did not exit after context cancellation")
	}

	if got := rec.Header().Get("Content-Type"); got != "text/event-stream" {
		t.Fatalf("stream content-type = %q, want text/event-stream", got)
	}
	body := rec.Body.String()
	if !strings.Contains(body, "event: snapshot") {
		t.Fatalf("stream body missing snapshot event: %q", body)
	}
	if !strings.Contains(body, `"boardId"`) {
		t.Fatalf("stream body missing snapshot payload: %q", body)
	}
}

func TestPublicAPITypedResponsesMatchCurrentContracts(t *testing.T) {
	s := newHTTPTestServer()
	registerRec := performRequest(t, s.handleRegister, http.MethodPost, "/api/heroes/register", `{"id":"hero-typed","name":"HeroTyped","strategy":"test strategy","preferredTrait":"cautious"}`)
	if registerRec.Code != http.StatusOK {
		t.Fatalf("typed register status = %d, want 200; body=%s", registerRec.Code, registerRec.Body.String())
	}
	registerPayload := decodeJSONInto[registerResponse](t, registerRec)
	if registerPayload.ID != "hero-typed" {
		t.Fatalf("typed register id = %q, want hero-typed", registerPayload.ID)
	}
	if registerPayload.Trait != game.TraitCautious {
		t.Fatalf("typed register trait = %s, want %s", registerPayload.Trait, game.TraitCautious)
	}
	if registerPayload.BoardID == "" {
		t.Fatalf("typed register missing board id")
	}
	if registerPayload.Stats.MaxHp <= 0 || registerPayload.TurnState.SubmitWindowMs != 12000 {
		t.Fatalf("typed register payload stats/turnState not populated: %+v %+v", registerPayload.Stats, registerPayload.TurnState)
	}

	observeRec := performRequest(t, s.handleHeroRoutes, http.MethodGet, "/api/heroes/hero-typed/observe", "")
	if observeRec.Code != http.StatusOK {
		t.Fatalf("typed observe status = %d, want 200; body=%s", observeRec.Code, observeRec.Body.String())
	}
	observePayload := decodeJSONInto[observeResponse](t, observeRec)
	if observePayload.Hero == nil || observePayload.Hero.ID != "hero-typed" {
		t.Fatalf("typed observe hero = %+v, want hero-typed", observePayload.Hero)
	}
	if observePayload.BoardStatus != game.LifecycleOpen {
		t.Fatalf("typed observe board status = %s, want %s", observePayload.BoardStatus, game.LifecycleOpen)
	}
	if len(observePayload.LegalActions) == 0 || len(observePayload.VisibleTiles) == 0 {
		t.Fatalf("typed observe payload missing legal actions or visible tiles")
	}

	healthRec := performRequest(t, s.handleHealth, http.MethodGet, "/api/health", "")
	healthPayload := decodeJSONInto[healthResponse](t, healthRec)
	if !healthPayload.OK || healthPayload.TurnState.Phase != game.PhaseSubmit {
		t.Fatalf("typed health payload = %+v, want ok submit-phase state", healthPayload)
	}

	dashboardRec := performRequest(t, s.handleDashboardAPI, http.MethodGet, "/api/dashboard", "")
	dashboardPayload := decodeJSONInto[game.BoardSnapshot](t, dashboardRec)
	if dashboardPayload.BoardID != registerPayload.BoardID {
		t.Fatalf("typed dashboard board id = %q, want %q", dashboardPayload.BoardID, registerPayload.BoardID)
	}
	if dashboardPayload.Lobby.Status != game.LifecycleOpen {
		t.Fatalf("typed dashboard lobby status = %s, want %s", dashboardPayload.Lobby.Status, game.LifecycleOpen)
	}

	boardsRec := performRequest(t, s.handleBoards, http.MethodGet, "/api/boards", "")
	boardsPayload := decodeJSONInto[game.ManagerSnapshot](t, boardsRec)
	if len(boardsPayload.Boards) == 0 {
		t.Fatalf("typed boards snapshot is empty")
	}
	if boardsPayload.Boards[0].BoardID == "" || boardsPayload.Boards[0].Seed == "" {
		t.Fatalf("typed boards entry incomplete: %+v", boardsPayload.Boards[0])
	}

	seedRec := performRequest(t, s.handleSeed, http.MethodGet, "/api/seed", "")
	seedPayload := decodeJSONInto[seedResponse](t, seedRec)
	if seedPayload.Seed == "" {
		t.Fatalf("typed seed payload missing seed")
	}

	leaderboardRec := performRequest(t, s.handleLeaderboard, http.MethodGet, "/api/leaderboard", "")
	leaderboardPayload := decodeJSONInto[leaderboardResponse](t, leaderboardRec)
	if len(leaderboardPayload.Leaderboard) == 0 {
		t.Fatalf("typed leaderboard payload is empty")
	}
	if leaderboardPayload.Leaderboard[0].HeroID != "hero-typed" {
		t.Fatalf("typed leaderboard first hero = %q, want hero-typed", leaderboardPayload.Leaderboard[0].HeroID)
	}

	logRec := performRequest(t, s.handleHeroRoutes, http.MethodPost, "/api/heroes/hero-typed/log", `{"message":"typed payload check"}`)
	logPayload := decodeJSONInto[logResponse](t, logRec)
	if !logPayload.OK {
		t.Fatalf("typed log payload = %+v, want ok=true", logPayload)
	}

	actRec := performRequest(t, s.handleHeroRoutes, http.MethodPost, "/api/heroes/hero-typed/act", `{"kind":"wait"}`)
	actPayload := decodeJSONInto[actionResponse](t, actRec)
	if !actPayload.Accepted || actPayload.Message == "" {
		t.Fatalf("typed act payload = %+v, want accepted action", actPayload)
	}
}

func TestPublicAPICompletedBoardsRouteTypedResponse(t *testing.T) {
	s := newHTTPTestServer()
	board, _, err := s.mgr.RegisterHero(game.HeroRegistration{ID: "hero-completed-typed", Name: "CompletedTyped", Strategy: "test"})
	if err != nil {
		t.Fatalf("register completed typed hero: %v", err)
	}
	s.mgr.CompleteBoard(board.ID, "Completed typed board.")

	rec := performRequest(t, s.handleCompletedBoards, http.MethodGet, "/api/boards/completed?offset=0&limit=5", "")
	if rec.Code != http.StatusOK {
		t.Fatalf("typed completed boards status = %d, want 200; body=%s", rec.Code, rec.Body.String())
	}
	payload := decodeJSONInto[completedBoardsResponse](t, rec)
	if payload.Total < 1 || len(payload.Boards) < 1 {
		t.Fatalf("typed completed boards payload unexpectedly empty: %+v", payload)
	}
	if payload.Boards[0].BoardID == "" || payload.Boards[0].CompletionReason == "" {
		t.Fatalf("typed completed board entry incomplete: %+v", payload.Boards[0])
	}
	if payload.Offset != 0 || payload.Limit != 5 {
		t.Fatalf("typed completed boards pagination = offset %d limit %d, want 0 and 5", payload.Offset, payload.Limit)
	}
	if payload.Boards[0].TopLeaderboard == nil {
		t.Fatalf("typed completed boards missing leaderboard slice")
	}
}

func TestAdminRoutesStartStopAndReset(t *testing.T) {
	s := newHTTPTestServer()
	board := s.mgr.ActiveBoard()
	if board == nil {
		t.Fatal("expected initial active board")
	}

	startRec := performRequest(t, s.handleAdminStart, http.MethodPost, "/api/admin/start", "")
	if startRec.Code != http.StatusOK {
		t.Fatalf("admin start status = %d, want 200; body=%s", startRec.Code, startRec.Body.String())
	}
	startPayload := decodeJSONInto[adminSnapshotResponse](t, startRec)
	if !startPayload.OK || startPayload.Snapshot.Lobby.Status != game.LifecycleRunning {
		t.Fatalf("admin start payload = %+v, want running snapshot", startPayload)
	}

	startAgainRec := performRequest(t, s.handleAdminStart, http.MethodPost, "/api/admin/start", "")
	startAgainPayload := decodeJSONInto[adminSnapshotResponse](t, startAgainRec)
	if !startAgainPayload.OK || !startAgainPayload.AlreadyStarted {
		t.Fatalf("admin start-again payload = %+v, want alreadyStarted", startAgainPayload)
	}

	resetWhileRunningRec := performRequest(t, s.handleAdminReset, http.MethodPost, "/api/admin/reset", "")
	if resetWhileRunningRec.Code != http.StatusConflict {
		t.Fatalf("admin reset while running status = %d, want 409; body=%s", resetWhileRunningRec.Code, resetWhileRunningRec.Body.String())
	}
	resetWhileRunningPayload := decodeJSONInto[adminSnapshotResponse](t, resetWhileRunningRec)
	if resetWhileRunningPayload.OK || resetWhileRunningPayload.Error != "board_running" {
		t.Fatalf("admin reset while running payload = %+v, want board_running conflict", resetWhileRunningPayload)
	}

	stopRec := performRequest(t, s.handleAdminStop, http.MethodPost, "/api/admin/stop", "")
	if stopRec.Code != http.StatusOK {
		t.Fatalf("admin stop status = %d, want 200; body=%s", stopRec.Code, stopRec.Body.String())
	}
	stopPayload := decodeJSONInto[adminSnapshotResponse](t, stopRec)
	if !stopPayload.OK || stopPayload.Snapshot.Lobby.Status != game.LifecycleCompleted {
		t.Fatalf("admin stop payload = %+v, want completed snapshot", stopPayload)
	}

	stopAgainRec := performRequest(t, s.handleAdminStop, http.MethodPost, "/api/admin/stop", "")
	stopAgainPayload := decodeJSONInto[adminSnapshotResponse](t, stopAgainRec)
	if !stopAgainPayload.OK || !stopAgainPayload.AlreadyStopped {
		t.Fatalf("admin stop-again payload = %+v, want alreadyStopped", stopAgainPayload)
	}

	resetRec := performRequest(t, s.handleAdminReset, http.MethodPost, "/api/admin/reset", "")
	if resetRec.Code != http.StatusOK {
		t.Fatalf("admin reset status = %d, want 200; body=%s", resetRec.Code, resetRec.Body.String())
	}
	resetPayload := decodeJSONInto[adminSnapshotResponse](t, resetRec)
	if !resetPayload.OK || resetPayload.BoardID == "" {
		t.Fatalf("admin reset payload = %+v, want new board id", resetPayload)
	}
	if resetPayload.Snapshot.Lobby.Status != game.LifecycleOpen {
		t.Fatalf("admin reset snapshot status = %s, want %s", resetPayload.Snapshot.Lobby.Status, game.LifecycleOpen)
	}
	if resetPayload.BoardID == board.ID {
		t.Fatalf("admin reset board id = %q, want a fresh board distinct from %q", resetPayload.BoardID, board.ID)
	}
	defer s.stopBeatLoop()
}
