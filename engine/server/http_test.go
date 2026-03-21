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
	ID             string         `json:"id"`
	Name           string         `json:"name"`
	Trait          game.HeroTrait `json:"trait"`
	Strategy       string         `json:"strategy"`
	Stats          game.HeroStats `json:"stats"`
	Position       game.Position  `json:"position"`
	BoardID        string         `json:"boardId"`
	SessionToken   string         `json:"sessionToken"`
	LeaseExpiresAt int64          `json:"leaseExpiresAt"`
	LeaseTTLms     int64          `json:"leaseTtlMs"`
	SessionStatus  string         `json:"sessionStatus"`
	RequestID      string         `json:"requestId"`
	TurnState      game.TurnState `json:"turnState"`
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
	LeaseExpiresAt  int64               `json:"leaseExpiresAt"`
	LeaseTTLms      int64               `json:"leaseTtlMs"`
	SessionStatus   string              `json:"sessionStatus"`
	RequestID       string              `json:"requestId"`
	TurnState       game.TurnState      `json:"turnState"`
}

type heartbeatResponse struct {
	OK             bool           `json:"ok"`
	BoardID        string         `json:"boardId"`
	LeaseExpiresAt int64          `json:"leaseExpiresAt"`
	LeaseTTLms     int64          `json:"leaseTtlMs"`
	SessionStatus  string         `json:"sessionStatus"`
	RequestID      string         `json:"requestId"`
	TurnState      game.TurnState `json:"turnState"`
}

type actionResponse struct {
	Accepted  bool           `json:"accepted"`
	Message   string         `json:"message"`
	Error     string         `json:"error"`
	RequestID string         `json:"requestId"`
	Replayed  bool           `json:"replayed"`
	TurnState game.TurnState `json:"turnState"`
}

type logResponse struct {
	OK        bool   `json:"ok"`
	RequestID string `json:"requestId"`
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

type adminSettingsResponse struct {
	OK       bool              `json:"ok"`
	Error    string            `json:"error"`
	Message  string            `json:"message"`
	Settings game.GameSettings `json:"settings"`
}

func newHTTPTestServer() *Server {
	return &Server{
		mgr:             game.NewManager(),
		playerAuthToken: defaultDevPlayerAuthToken,
		adminAuthToken:  defaultDevAdminAuthToken,
		planningMs:      12000,
		actionMs:        500,
		maxTurns:        game.CFG.MaxTurnsPerBoard,
		turnPhase:       game.PhaseSubmit,
		phaseStartAt:    time.Now(),
		phaseEndAt:      time.Now().Add(12 * time.Second),
		streamClients:   make(map[*sseClient]bool),
		dashboardHTML:   "<html><body>dashboard</body></html>",
		gameSettings: game.GameSettings{
			Paused:          false,
			SubmitWindowMs:  12000,
			ResolveWindowMs: 500,
		},
		heroSessionLeaseMs: defaultHeroSessionLeaseMs,
		heroSessions:       make(map[string]heroSession),
		actionCache:        make(map[string]cachedActionResponse),
	}
}

func setHeroSessionExpiry(t *testing.T, s *Server, heroID string, expiry time.Time) {
	t.Helper()
	s.mu.Lock()
	defer s.mu.Unlock()
	session, ok := s.heroSessions[heroID]
	if !ok {
		t.Fatalf("missing hero session for %s", heroID)
	}
	session.LeaseExpiresAt = expiry
	s.heroSessions[heroID] = session
}

func performPlayerRequest(t *testing.T, handler http.HandlerFunc, method string, target string, body string, sessionToken string) *httptest.ResponseRecorder {
	t.Helper()
	req := httptest.NewRequest(method, target, bytes.NewBufferString(body))
	if body != "" {
		req.Header.Set("Content-Type", "application/json")
	}
	req.Header.Set("Authorization", "Bearer "+defaultDevPlayerAuthToken)
	if sessionToken != "" {
		req.Header.Set("X-Hero-Session-Token", sessionToken)
	}
	rec := httptest.NewRecorder()
	handler(rec, req)
	return rec
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

func performAdminRequest(t *testing.T, handler http.HandlerFunc, method string, target string, body string) *httptest.ResponseRecorder {
	t.Helper()
	req := httptest.NewRequest(method, target, bytes.NewBufferString(body))
	if body != "" {
		req.Header.Set("Content-Type", "application/json")
	}
	req.Header.Set("Authorization", "Bearer "+defaultDevAdminAuthToken)
	rec := httptest.NewRecorder()
	handler(rec, req)
	return rec
}

func performRequestWithoutAuth(t *testing.T, handler http.HandlerFunc, method string, target string, body string) *httptest.ResponseRecorder {
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

func TestCORSPreflightAllowsCrossOriginDashboardClients(t *testing.T) {
	handler := withCORS(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusOK)
	}))

	req := httptest.NewRequest(http.MethodOptions, "/api/admin/settings", nil)
	req.Header.Set("Origin", "https://dashboard.example")
	req.Header.Set("Access-Control-Request-Method", http.MethodPost)
	req.Header.Set("Access-Control-Request-Headers", "Authorization, Content-Type, X-Hero-Session-Token")
	rec := httptest.NewRecorder()

	handler.ServeHTTP(rec, req)

	if rec.Code != http.StatusNoContent {
		t.Fatalf("preflight status = %d, want %d", rec.Code, http.StatusNoContent)
	}
	if got := rec.Header().Get("Access-Control-Allow-Origin"); got != "*" {
		t.Fatalf("allow origin = %q, want *", got)
	}
	allowHeaders := rec.Header().Get("Access-Control-Allow-Headers")
	for _, required := range []string{"Authorization", "Content-Type", "Idempotency-Key", "Last-Event-ID", "X-Hero-Session-Token", "X-Request-Id"} {
		if !strings.Contains(allowHeaders, required) {
			t.Fatalf("allow headers %q missing %q", allowHeaders, required)
		}
	}
	if got := rec.Header().Get("Access-Control-Max-Age"); got != "600" {
		t.Fatalf("max age = %q, want 600", got)
	}
}

func TestCORSExposesRequestIDHeaderToBrowserClients(t *testing.T) {
	handler := withCORS(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("X-Request-Id", "req-browser")
		w.WriteHeader(http.StatusOK)
	}))

	req := httptest.NewRequest(http.MethodGet, "/api/dashboard", nil)
	req.Header.Set("Origin", "https://dashboard.example")
	rec := httptest.NewRecorder()

	handler.ServeHTTP(rec, req)

	if rec.Code != http.StatusOK {
		t.Fatalf("dashboard status = %d, want %d", rec.Code, http.StatusOK)
	}
	if got := rec.Header().Get("Access-Control-Expose-Headers"); !strings.Contains(got, "X-Request-Id") {
		t.Fatalf("exposed headers = %q, want X-Request-Id", got)
	}
	if got := rec.Header().Get("X-Request-Id"); got != "req-browser" {
		t.Fatalf("request id header = %q, want req-browser", got)
	}
}

func registerHTTPTestHero(t *testing.T, s *Server, id string) map[string]interface{} {
	t.Helper()
	body := fmt.Sprintf(`{"id":"%s","name":"%s","strategy":"test strategy","preferredTrait":"curious"}`, id, strings.ToUpper(id[:1])+id[1:])
	rec := performPlayerRequest(t, s.handleRegister, http.MethodPost, "/api/heroes/register", body, "")
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
	sessionToken, _ := reg["sessionToken"].(string)
	if sessionToken == "" {
		t.Fatal("register response missing sessionToken")
	}
	if reg["requestId"] == "" {
		t.Fatal("register response missing requestId")
	}
	if leaseTTL, ok := reg["leaseTtlMs"].(float64); !ok || leaseTTL <= 0 {
		t.Fatalf("register response missing leaseTtlMs: %v", reg["leaseTtlMs"])
	}
	if leaseExpiry, ok := reg["leaseExpiresAt"].(float64); !ok || leaseExpiry <= 0 {
		t.Fatalf("register response missing leaseExpiresAt: %v", reg["leaseExpiresAt"])
	}
	if reg["sessionStatus"] != string(heroSessionActive) {
		t.Fatalf("register sessionStatus = %v, want %s", reg["sessionStatus"], heroSessionActive)
	}

	observe := performPlayerRequest(t, s.handleHeroRoutes, http.MethodGet, "/api/heroes/hero-http/observe", "", sessionToken)
	if observe.Code != http.StatusOK {
		t.Fatalf("observe status = %d, want 200; body=%s", observe.Code, observe.Body.String())
	}
	observePayload := decodeJSONMap(t, observe)
	for _, key := range []string{"seed", "turn", "boardId", "boardStatus", "hero", "visibleTiles", "visibleMonsters", "visibleHeroes", "visibleNpcs", "visibleItems", "recentEvents", "legalActions", "turnState"} {
		if _, ok := observePayload[key]; !ok {
			t.Fatalf("observe response missing key %q", key)
		}
	}
	if observePayload["sessionStatus"] != string(heroSessionActive) {
		t.Fatalf("observe sessionStatus = %v, want %s", observePayload["sessionStatus"], heroSessionActive)
	}

	act := performPlayerRequest(t, s.handleHeroRoutes, http.MethodPost, "/api/heroes/hero-http/act", `{"kind":"wait"}`, sessionToken)
	if act.Code != http.StatusOK {
		t.Fatalf("act status = %d, want 200; body=%s", act.Code, act.Body.String())
	}
	actPayload := decodeJSONMap(t, act)
	if accepted, ok := actPayload["accepted"].(bool); !ok || !accepted {
		t.Fatalf("act accepted = %v, want true", actPayload["accepted"])
	}

	rejected := performPlayerRequest(t, s.handleHeroRoutes, http.MethodPost, "/api/heroes/hero-http/act", `{"kind":"wait"}`, sessionToken)
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

	logResp := performPlayerRequest(t, s.handleHeroRoutes, http.MethodPost, "/api/heroes/hero-http/log", `{"message":"moving north next turn"}`, sessionToken)
	if logResp.Code != http.StatusOK {
		t.Fatalf("log status = %d, want 200; body=%s", logResp.Code, logResp.Body.String())
	}
	logPayload := decodeJSONMap(t, logResp)
	if ok, _ := logPayload["ok"].(bool); !ok {
		t.Fatalf("log ok = %v, want true", logPayload["ok"])
	}

	badLog := performPlayerRequest(t, s.handleHeroRoutes, http.MethodPost, "/api/heroes/hero-http/log", `{"message":"   "}`, sessionToken)
	if badLog.Code != http.StatusBadRequest {
		t.Fatalf("blank log status = %d, want 400; body=%s", badLog.Code, badLog.Body.String())
	}
}

func TestHeroHeartbeatRenewsLease(t *testing.T) {
	s := newHTTPTestServer()
	reg := registerHTTPTestHero(t, s, "hero-heartbeat")
	sessionToken, _ := reg["sessionToken"].(string)
	oldExpiry := time.Now().Add(10 * time.Millisecond)
	setHeroSessionExpiry(t, s, "hero-heartbeat", oldExpiry)

	rec := performPlayerRequest(t, s.handleHeroRoutes, http.MethodPost, "/api/heroes/hero-heartbeat/heartbeat", "", sessionToken)
	if rec.Code != http.StatusOK {
		t.Fatalf("heartbeat status = %d, want 200; body=%s", rec.Code, rec.Body.String())
	}
	payload := decodeJSONInto[heartbeatResponse](t, rec)
	if !payload.OK {
		t.Fatalf("heartbeat ok = %v, want true", payload.OK)
	}
	if payload.BoardID == "" || payload.RequestID == "" {
		t.Fatalf("heartbeat payload missing boardId/requestId: %+v", payload)
	}
	if payload.SessionStatus != string(heroSessionActive) {
		t.Fatalf("heartbeat sessionStatus = %s, want %s", payload.SessionStatus, heroSessionActive)
	}
	if payload.LeaseTTLms <= 0 || payload.LeaseExpiresAt <= oldExpiry.UnixMilli() {
		t.Fatalf("heartbeat lease not renewed: %+v old=%d", payload, oldExpiry.UnixMilli())
	}
}

func TestExpiredOpenBoardSessionEvictsHeroAndAllowsReregister(t *testing.T) {
	s := newHTTPTestServer()
	reg := registerHTTPTestHero(t, s, "hero-open-expired")
	oldSessionToken, _ := reg["sessionToken"].(string)
	setHeroSessionExpiry(t, s, "hero-open-expired", time.Now().Add(-time.Second))
	s.expireHeroSessions(time.Now())

	if board := s.mgr.FindBoardForHero("hero-open-expired"); board != nil {
		t.Fatalf("expected expired open-board hero to be removed, still found on board %s", board.ID)
	}

	observe := performPlayerRequest(t, s.handleHeroRoutes, http.MethodGet, "/api/heroes/hero-open-expired/observe", "", oldSessionToken)
	if observe.Code != http.StatusNotFound {
		t.Fatalf("observe after open-board expiry status = %d, want 404; body=%s", observe.Code, observe.Body.String())
	}

	reregister := registerHTTPTestHero(t, s, "hero-open-expired")
	newSessionToken, _ := reregister["sessionToken"].(string)
	if newSessionToken == "" || newSessionToken == oldSessionToken {
		t.Fatalf("re-register session token = %q, want a fresh token distinct from %q", newSessionToken, oldSessionToken)
	}
	if board := s.mgr.FindBoardForHero("hero-open-expired"); board == nil {
		t.Fatal("expected hero to rejoin an open board after expiry")
	}
}

func TestExpiredRunningBoardSessionRejectsRequestsAndMarksHeroInactive(t *testing.T) {
	s := newHTTPTestServer()
	reg := registerHTTPTestHero(t, s, "hero-running-expired")
	sessionToken, _ := reg["sessionToken"].(string)
	board := s.mgr.FindBoardForHero("hero-running-expired")
	if board == nil {
		t.Fatal("expected running-board test hero to be registered")
	}
	board.SetLifecycle(game.LifecycleRunning)
	setHeroSessionExpiry(t, s, "hero-running-expired", time.Now().Add(-time.Second))
	s.expireHeroSessions(time.Now())

	rec := performPlayerRequest(t, s.handleHeroRoutes, http.MethodGet, "/api/heroes/hero-running-expired/observe", "", sessionToken)
	if rec.Code != http.StatusUnauthorized {
		t.Fatalf("observe after running-board expiry status = %d, want 401; body=%s", rec.Code, rec.Body.String())
	}
	payload := decodeJSONMap(t, rec)
	if payload["error"] != "expired_session" {
		t.Fatalf("expired running-board error = %v, want expired_session", payload["error"])
	}

	snap := board.Snapshot(s.getTurnState(board))
	if len(snap.Heroes) != 1 {
		t.Fatalf("running-board snapshot hero count = %d, want 1", len(snap.Heroes))
	}
	if snap.Heroes[0].LastAction != "session expired" {
		t.Fatalf("running-board hero lastAction = %q, want session expired", snap.Heroes[0].LastAction)
	}
}

func TestRegisterRouteDoesNotAutoStartBoardWhilePaused(t *testing.T) {
	s := newHTTPTestServer()
	s.gameSettings = game.GameSettings{Paused: true}

	for i := 0; i < game.CFG.MinBotsToStart; i++ {
		registerHTTPTestHero(t, s, fmt.Sprintf("hero-paused-http-%d", i))
	}

	board := s.mgr.ActiveBoard()
	if board == nil {
		t.Fatal("expected active board after paused registrations")
	}
	if board.Lifecycle() != game.LifecycleOpen {
		t.Fatalf("board lifecycle = %s, want %s while paused", board.Lifecycle(), game.LifecycleOpen)
	}
	if state := s.getTurnState(board); state.Started {
		t.Fatalf("turn state started = %v, want false while paused", state.Started)
	}
	if board.EventCount() == 0 {
		t.Fatal("expected registration events to still be recorded")
	}
}

func TestPublicAPIActRouteRejectsWrongPhase(t *testing.T) {
	s := newHTTPTestServer()
	reg := registerHTTPTestHero(t, s, "hero-phase")
	s.turnPhase = game.PhaseResolve

	sessionToken, _ := reg["sessionToken"].(string)
	rec := performPlayerRequest(t, s.handleHeroRoutes, http.MethodPost, "/api/heroes/hero-phase/act", `{"kind":"wait"}`, sessionToken)
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

func TestProtectedRoutesRequireBearerToken(t *testing.T) {
	s := newHTTPTestServer()

	register := performRequestWithoutAuth(t, s.handleRegister, http.MethodPost, "/api/heroes/register", `{"id":"hero-auth","name":"HeroAuth","strategy":"test strategy"}`)
	if register.Code != http.StatusUnauthorized {
		t.Fatalf("register without auth status = %d, want 401; body=%s", register.Code, register.Body.String())
	}
	registerPayload := decodeJSONMap(t, register)
	if registerPayload["error"] != "missing_auth" {
		t.Fatalf("register without auth error = %v, want missing_auth", registerPayload["error"])
	}

	reg := registerHTTPTestHero(t, s, "hero-auth-ok")
	sessionToken, _ := reg["sessionToken"].(string)
	observe := performRequestWithoutAuth(t, s.handleHeroRoutes, http.MethodGet, "/api/heroes/hero-auth-ok/observe", "")
	if observe.Code != http.StatusUnauthorized {
		t.Fatalf("observe without auth status = %d, want 401; body=%s", observe.Code, observe.Body.String())
	}

	reqMissingSession := httptest.NewRequest(http.MethodGet, "/api/heroes/hero-auth-ok/observe", bytes.NewBufferString(""))
	reqMissingSession.Header.Set("Authorization", "Bearer "+defaultDevPlayerAuthToken)
	recMissingSession := httptest.NewRecorder()
	s.handleHeroRoutes(recMissingSession, reqMissingSession)
	if recMissingSession.Code != http.StatusUnauthorized {
		t.Fatalf("observe without session token status = %d, want 401; body=%s", recMissingSession.Code, recMissingSession.Body.String())
	}
	missingSessionPayload := decodeJSONMap(t, recMissingSession)
	if missingSessionPayload["error"] != "missing_session" {
		t.Fatalf("observe without session error = %v, want missing_session", missingSessionPayload["error"])
	}

	reqWrongSession := httptest.NewRequest(http.MethodGet, "/api/heroes/hero-auth-ok/observe", bytes.NewBufferString(""))
	reqWrongSession.Header.Set("Authorization", "Bearer "+defaultDevPlayerAuthToken)
	reqWrongSession.Header.Set("X-Hero-Session-Token", sessionToken+"-wrong")
	recWrongSession := httptest.NewRecorder()
	s.handleHeroRoutes(recWrongSession, reqWrongSession)
	if recWrongSession.Code != http.StatusUnauthorized {
		t.Fatalf("observe with wrong session token status = %d, want 401; body=%s", recWrongSession.Code, recWrongSession.Body.String())
	}

	admin := performRequestWithoutAuth(t, s.handleAdminStart, http.MethodPost, "/api/admin/start", "")
	if admin.Code != http.StatusUnauthorized {
		t.Fatalf("admin start without auth status = %d, want 401; body=%s", admin.Code, admin.Body.String())
	}
	adminPayload := decodeJSONMap(t, admin)
	if adminPayload["error"] != "missing_auth" {
		t.Fatalf("admin start without auth error = %v, want missing_auth", adminPayload["error"])
	}

	req := httptest.NewRequest(http.MethodPost, "/api/admin/start", bytes.NewBufferString(""))
	req.Header.Set("Authorization", "Bearer wrong-token")
	rec := httptest.NewRecorder()
	s.handleAdminStart(rec, req)
	if rec.Code != http.StatusUnauthorized {
		t.Fatalf("admin start with wrong auth status = %d, want 401; body=%s", rec.Code, rec.Body.String())
	}
	wrongPayload := decodeJSONMap(t, rec)
	if wrongPayload["error"] != "invalid_auth" {
		t.Fatalf("admin start with wrong auth error = %v, want invalid_auth", wrongPayload["error"])
	}

	wrongPlayerReq := httptest.NewRequest(http.MethodPost, "/api/admin/start", bytes.NewBufferString(""))
	wrongPlayerReq.Header.Set("Authorization", "Bearer "+defaultDevPlayerAuthToken)
	wrongPlayerRec := httptest.NewRecorder()
	s.handleAdminStart(wrongPlayerRec, wrongPlayerReq)
	if wrongPlayerRec.Code != http.StatusUnauthorized {
		t.Fatalf("admin start with player token status = %d, want 401; body=%s", wrongPlayerRec.Code, wrongPlayerRec.Body.String())
	}
}

func TestActRouteReplaysCachedResponseForMatchingIdempotencyKey(t *testing.T) {
	s := newHTTPTestServer()
	reg := registerHTTPTestHero(t, s, "hero-idempotent")
	sessionToken, _ := reg["sessionToken"].(string)

	request := httptest.NewRequest(http.MethodPost, "/api/heroes/hero-idempotent/act", bytes.NewBufferString(`{"kind":"wait"}`))
	request.Header.Set("Authorization", "Bearer "+defaultDevPlayerAuthToken)
	request.Header.Set("Content-Type", "application/json")
	request.Header.Set("X-Hero-Session-Token", sessionToken)
	request.Header.Set("Idempotency-Key", "test-key")
	first := httptest.NewRecorder()
	s.handleHeroRoutes(first, request)
	if first.Code != http.StatusOK {
		t.Fatalf("first idempotent act status = %d, want 200; body=%s", first.Code, first.Body.String())
	}
	firstPayload := decodeJSONMap(t, first)
	if replayed, _ := firstPayload["replayed"].(bool); replayed {
		t.Fatal("first idempotent act should not be marked replayed")
	}

	retry := httptest.NewRequest(http.MethodPost, "/api/heroes/hero-idempotent/act", bytes.NewBufferString(`{"kind":"wait"}`))
	retry.Header.Set("Authorization", "Bearer "+defaultDevPlayerAuthToken)
	retry.Header.Set("Content-Type", "application/json")
	retry.Header.Set("X-Hero-Session-Token", sessionToken)
	retry.Header.Set("Idempotency-Key", "test-key")
	second := httptest.NewRecorder()
	s.handleHeroRoutes(second, retry)
	if second.Code != http.StatusOK {
		t.Fatalf("second idempotent act status = %d, want 200; body=%s", second.Code, second.Body.String())
	}
	secondPayload := decodeJSONMap(t, second)
	if replayed, _ := secondPayload["replayed"].(bool); !replayed {
		t.Fatalf("second idempotent act replayed = %v, want true", secondPayload["replayed"])
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
	if !strings.Contains(body, `"gameSettings"`) {
		t.Fatalf("stream body missing gameSettings payload: %q", body)
	}
}

func TestPublicAPITypedResponsesMatchCurrentContracts(t *testing.T) {
	s := newHTTPTestServer()
	registerRec := performPlayerRequest(t, s.handleRegister, http.MethodPost, "/api/heroes/register", `{"id":"hero-typed","name":"HeroTyped","strategy":"test strategy","preferredTrait":"cautious"}`, "")
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
	if registerPayload.SessionToken == "" || registerPayload.RequestID == "" {
		t.Fatalf("typed register payload missing sessionToken/requestId: %+v", registerPayload)
	}
	if registerPayload.LeaseExpiresAt <= 0 || registerPayload.LeaseTTLms <= 0 || registerPayload.SessionStatus != string(heroSessionActive) {
		t.Fatalf("typed register payload missing lease metadata: %+v", registerPayload)
	}

	observeRec := performPlayerRequest(t, s.handleHeroRoutes, http.MethodGet, "/api/heroes/hero-typed/observe", "", registerPayload.SessionToken)
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
	if observePayload.RequestID == "" {
		t.Fatalf("typed observe payload missing requestId: %+v", observePayload)
	}
	if observePayload.LeaseExpiresAt <= 0 || observePayload.LeaseTTLms <= 0 || observePayload.SessionStatus != string(heroSessionActive) {
		t.Fatalf("typed observe payload missing lease metadata: %+v", observePayload)
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

	logRec := performPlayerRequest(t, s.handleHeroRoutes, http.MethodPost, "/api/heroes/hero-typed/log", `{"message":"typed payload check"}`, registerPayload.SessionToken)
	logPayload := decodeJSONInto[logResponse](t, logRec)
	if !logPayload.OK {
		t.Fatalf("typed log payload = %+v, want ok=true", logPayload)
	}
	if logPayload.RequestID == "" {
		t.Fatalf("typed log payload missing requestId: %+v", logPayload)
	}

	actRec := performPlayerRequest(t, s.handleHeroRoutes, http.MethodPost, "/api/heroes/hero-typed/act", `{"kind":"wait"}`, registerPayload.SessionToken)
	actPayload := decodeJSONInto[actionResponse](t, actRec)
	if !actPayload.Accepted || actPayload.Message == "" || actPayload.RequestID == "" {
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

	startRec := performAdminRequest(t, s.handleAdminStart, http.MethodPost, "/api/admin/start", "")
	if startRec.Code != http.StatusOK {
		t.Fatalf("admin start status = %d, want 200; body=%s", startRec.Code, startRec.Body.String())
	}
	startPayload := decodeJSONInto[adminSnapshotResponse](t, startRec)
	if !startPayload.OK || startPayload.Snapshot.Lobby.Status != game.LifecycleRunning {
		t.Fatalf("admin start payload = %+v, want running snapshot", startPayload)
	}

	startAgainRec := performAdminRequest(t, s.handleAdminStart, http.MethodPost, "/api/admin/start", "")
	startAgainPayload := decodeJSONInto[adminSnapshotResponse](t, startAgainRec)
	if !startAgainPayload.OK || !startAgainPayload.AlreadyStarted {
		t.Fatalf("admin start-again payload = %+v, want alreadyStarted", startAgainPayload)
	}

	resetWhileRunningRec := performAdminRequest(t, s.handleAdminReset, http.MethodPost, "/api/admin/reset", "")
	if resetWhileRunningRec.Code != http.StatusConflict {
		t.Fatalf("admin reset while running status = %d, want 409; body=%s", resetWhileRunningRec.Code, resetWhileRunningRec.Body.String())
	}
	resetWhileRunningPayload := decodeJSONInto[adminSnapshotResponse](t, resetWhileRunningRec)
	if resetWhileRunningPayload.OK || resetWhileRunningPayload.Error != "board_running" {
		t.Fatalf("admin reset while running payload = %+v, want board_running conflict", resetWhileRunningPayload)
	}

	stopRec := performAdminRequest(t, s.handleAdminStop, http.MethodPost, "/api/admin/stop", "")
	if stopRec.Code != http.StatusOK {
		t.Fatalf("admin stop status = %d, want 200; body=%s", stopRec.Code, stopRec.Body.String())
	}
	stopPayload := decodeJSONInto[adminSnapshotResponse](t, stopRec)
	if !stopPayload.OK || stopPayload.Snapshot.Lobby.Status != game.LifecycleCompleted {
		t.Fatalf("admin stop payload = %+v, want completed snapshot", stopPayload)
	}

	stopAgainRec := performAdminRequest(t, s.handleAdminStop, http.MethodPost, "/api/admin/stop", "")
	stopAgainPayload := decodeJSONInto[adminSnapshotResponse](t, stopAgainRec)
	if !stopAgainPayload.OK || !stopAgainPayload.AlreadyStopped {
		t.Fatalf("admin stop-again payload = %+v, want alreadyStopped", stopAgainPayload)
	}

	resetRec := performAdminRequest(t, s.handleAdminReset, http.MethodPost, "/api/admin/reset", "")
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

func TestAdminSettingsUnpauseDoesNotStartUnderfilledBoard(t *testing.T) {
	s := newHTTPTestServer()
	s.gameSettings = game.GameSettings{Paused: true, SubmitWindowMs: 12000, ResolveWindowMs: 500}
	activeBefore := s.mgr.ActiveBoard()
	if activeBefore == nil {
		t.Fatal("expected active board before registrations")
	}

	registerHTTPTestHero(t, s, "hero-settings-1")
	registerHTTPTestHero(t, s, "hero-settings-2")

	board := s.mgr.ActiveBoard()
	if board == nil {
		t.Fatal("expected active board")
	}
	if board.Lifecycle() != game.LifecycleOpen {
		t.Fatalf("board lifecycle before unpause = %s, want %s", board.Lifecycle(), game.LifecycleOpen)
	}
	if deadline := board.AutoStartAfter(); deadline.IsZero() {
		t.Fatal("expected join window to be armed for underfilled lobby")
	}

	settingsRec := performAdminRequest(t, s.handleAdminSettings, http.MethodPost, "/api/admin/settings", `{"paused":false,"includeLandmarks":false,"includePlayerPositions":false,"submitWindowMs":12000,"resolveWindowMs":500}`)
	if settingsRec.Code != http.StatusOK {
		t.Fatalf("admin settings status = %d, want 200; body=%s", settingsRec.Code, settingsRec.Body.String())
	}
	settingsPayload := decodeJSONInto[adminSettingsResponse](t, settingsRec)
	if !settingsPayload.OK || settingsPayload.Settings.Paused {
		t.Fatalf("admin settings payload = %+v, want unpaused settings", settingsPayload)
	}

	if board.Lifecycle() != game.LifecycleOpen {
		t.Fatalf("board lifecycle after unpause = %s, want %s with only 2 heroes", board.Lifecycle(), game.LifecycleOpen)
	}
	if turnState := s.getTurnState(board); turnState.Started {
		t.Fatalf("turn state started = %v, want false after unpausing underfilled board", turnState.Started)
	}
}

func TestAdminStartRejectsWhilePaused(t *testing.T) {
	s := newHTTPTestServer()
	s.gameSettings = game.GameSettings{Paused: true, SubmitWindowMs: 12000, ResolveWindowMs: 500}
	board := s.mgr.EnsureOpenBoard()
	for i := 0; i < game.CFG.MinBotsToStart; i++ {
		registerHTTPTestHero(t, s, fmt.Sprintf("hero-paused-start-%d", i))
	}

	startRec := performAdminRequest(t, s.handleAdminStart, http.MethodPost, "/api/admin/start", "")
	if startRec.Code != http.StatusConflict {
		t.Fatalf("admin start status = %d, want 409; body=%s", startRec.Code, startRec.Body.String())
	}
	startPayload := decodeJSONInto[adminSnapshotResponse](t, startRec)
	if startPayload.OK || startPayload.Error != "game_paused" {
		t.Fatalf("admin start payload = %+v, want game_paused rejection", startPayload)
	}
	if board.Lifecycle() != game.LifecycleOpen {
		t.Fatalf("board lifecycle = %s, want %s while paused", board.Lifecycle(), game.LifecycleOpen)
	}
}

func TestAdminSettingsUpdatesTurnWindowsAndPreservesTimingInResponse(t *testing.T) {
	s := newHTTPTestServer()
	s.gameSettings = game.GameSettings{
		Paused:                 false,
		IncludeLandmarks:       true,
		IncludePlayerPositions: true,
		SubmitWindowMs:         12000,
		ResolveWindowMs:        500,
	}

	settingsRec := performAdminRequest(t, s.handleAdminSettings, http.MethodPost, "/api/admin/settings", `{"paused":false,"includeLandmarks":false,"includePlayerPositions":true,"submitWindowMs":2000,"resolveWindowMs":250}`)
	if settingsRec.Code != http.StatusOK {
		t.Fatalf("admin timing settings status = %d, want 200; body=%s", settingsRec.Code, settingsRec.Body.String())
	}
	settingsPayload := decodeJSONInto[adminSettingsResponse](t, settingsRec)
	if !settingsPayload.OK {
		t.Fatalf("admin timing settings payload = %+v, want ok=true", settingsPayload)
	}
	if settingsPayload.Settings.SubmitWindowMs != 2000 || settingsPayload.Settings.ResolveWindowMs != 250 {
		t.Fatalf("admin timing settings = %+v, want submit=2000 resolve=250", settingsPayload.Settings)
	}
	if s.planningMs != 2000 || s.actionMs != 250 {
		t.Fatalf("server timing = submit %d resolve %d, want 2000 and 250", s.planningMs, s.actionMs)
	}

	healthRec := performRequest(t, s.handleHealth, http.MethodGet, "/api/health", "")
	healthPayload := decodeJSONInto[healthResponse](t, healthRec)
	if healthPayload.TurnState.SubmitWindowMs != 2000 || healthPayload.TurnState.ResolveWindowMs != 250 {
		t.Fatalf("health turn state = %+v, want submit=2000 resolve=250", healthPayload.TurnState)
	}

	getRec := performAdminRequest(t, s.handleAdminSettings, http.MethodGet, "/api/admin/settings", "")
	getPayload := decodeJSONInto[game.GameSettings](t, getRec)
	if getPayload.SubmitWindowMs != 2000 || getPayload.ResolveWindowMs != 250 {
		t.Fatalf("admin settings get payload = %+v, want submit=2000 resolve=250", getPayload)
	}
}
