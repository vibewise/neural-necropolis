package server

import (
	"encoding/json"
	"os"
	"path/filepath"
	"sort"
	"strings"
	"testing"

	"github.com/mmorph/engine/game"
)

func readPublicContract(t *testing.T) map[string]any {
	t.Helper()
	path := filepath.Join("..", "..", "docs", "PUBLIC_API.openapi.json")
	content, err := os.ReadFile(path)
	if err != nil {
		t.Fatalf("read public api contract: %v", err)
	}

	var doc map[string]any
	if err := json.Unmarshal(content, &doc); err != nil {
		t.Fatalf("decode public api contract: %v", err)
	}
	return doc
}

func contractMap(t *testing.T, value any, context string) map[string]any {
	t.Helper()
	result, ok := value.(map[string]any)
	if !ok {
		t.Fatalf("%s = %T, want object", context, value)
	}
	return result
}

func contractString(t *testing.T, value any, context string) string {
	t.Helper()
	result, ok := value.(string)
	if !ok {
		t.Fatalf("%s = %T, want string", context, value)
	}
	return result
}

func contractRequiredFields(t *testing.T, doc map[string]any, schemaName string) []string {
	t.Helper()
	components := contractMap(t, doc["components"], "components")
	schemas := contractMap(t, components["schemas"], "components.schemas")
	schema := contractMap(t, schemas[schemaName], "schema "+schemaName)

	if requiredAny, ok := schema["required"]; ok {
		items, ok := requiredAny.([]any)
		if !ok {
			t.Fatalf("schema %s required = %T, want array", schemaName, requiredAny)
		}
		fields := make([]string, 0, len(items))
		for _, item := range items {
			fields = append(fields, contractString(t, item, "required field"))
		}
		sort.Strings(fields)
		return fields
	}

	allOfAny, ok := schema["allOf"]
	if !ok {
		return nil
	}
	allOf, ok := allOfAny.([]any)
	if !ok {
		t.Fatalf("schema %s allOf = %T, want array", schemaName, allOfAny)
	}
	fields := make([]string, 0)
	for _, entry := range allOf {
		entryMap := contractMap(t, entry, "allOf entry")
		if refAny, hasRef := entryMap["$ref"]; hasRef {
			ref := contractString(t, refAny, "$ref")
			const prefix = "#/components/schemas/"
			if !strings.HasPrefix(ref, prefix) {
				t.Fatalf("unexpected schema ref %q", ref)
			}
			fields = append(fields, contractRequiredFields(t, doc, strings.TrimPrefix(ref, prefix))...)
			continue
		}
		if requiredAny, hasRequired := entryMap["required"]; hasRequired {
			required := requiredAny.([]any)
			for _, item := range required {
				fields = append(fields, contractString(t, item, "required field"))
			}
		}
	}
	sort.Strings(fields)
	return fields
}

func assertJSONHasRequiredKeys(t *testing.T, payload map[string]any, required []string, context string) {
	t.Helper()
	for _, key := range required {
		if _, ok := payload[key]; !ok {
			t.Fatalf("%s missing required key %q", context, key)
		}
	}
}

func TestPublicAPIContractHasMetadataAndVersioningPolicy(t *testing.T) {
	doc := readPublicContract(t)
	if got := contractString(t, doc["openapi"], "openapi"); got != "3.1.0" {
		t.Fatalf("openapi version = %q, want 3.1.0", got)
	}
	info := contractMap(t, doc["info"], "info")
	if got := contractString(t, info["title"], "info.title"); got != "Neural Necropolis Public API" {
		t.Fatalf("contract title = %q, want Neural Necropolis Public API", got)
	}
	if got := contractString(t, info["version"], "info.version"); got != "1.0.0" {
		t.Fatalf("contract version = %q, want 1.0.0", got)
	}
	versioning := contractMap(t, doc["x-neural-necropolis-versioning"], "x-neural-necropolis-versioning")
	if got := int(versioning["currentMajor"].(float64)); got != 1 {
		t.Fatalf("currentMajor = %d, want 1", got)
	}
	if contractString(t, versioning["pathStrategy"], "versioning.pathStrategy") == "" {
		t.Fatal("versioning.pathStrategy is empty")
	}
}

func TestPublicAPIContractDefinesDashboardBoundaryAndStreamMetadata(t *testing.T) {
	doc := readPublicContract(t)
	boundary := contractMap(t, doc["x-neural-necropolis-boundary"], "x-neural-necropolis-boundary")

	spectatorRoutes, ok := boundary["spectatorRoutes"].([]any)
	if !ok || len(spectatorRoutes) == 0 {
		t.Fatal("spectatorRoutes missing or empty")
	}
	playerRoutes, ok := boundary["playerRoutes"].([]any)
	if !ok || len(playerRoutes) == 0 {
		t.Fatal("playerRoutes missing or empty")
	}
	operatorRoutes, ok := boundary["operatorRoutesExcluded"].([]any)
	if !ok || len(operatorRoutes) == 0 {
		t.Fatal("operatorRoutesExcluded missing or empty")
	}
	if contractString(t, boundary["dashboardRole"], "boundary.dashboardRole") == "" {
		t.Fatal("dashboardRole is empty")
	}

	streamContract := contractMap(t, boundary["streamContract"], "boundary.streamContract")
	if got := contractString(t, streamContract["transport"], "streamContract.transport"); got != "text/event-stream" {
		t.Fatalf("stream transport = %q, want text/event-stream", got)
	}
	if got := contractString(t, streamContract["firstEvent"], "streamContract.firstEvent"); got != "snapshot" {
		t.Fatalf("stream firstEvent = %q, want snapshot", got)
	}
	eventTypes := contractMap(t, streamContract["eventTypes"], "streamContract.eventTypes")
	if _, ok := eventTypes["snapshot"]; !ok {
		t.Fatal("streamContract.eventTypes missing snapshot")
	}
	if _, ok := eventTypes["log"]; !ok {
		t.Fatal("streamContract.eventTypes missing log")
	}

	paths := contractMap(t, doc["paths"], "paths")
	stream := contractMap(t, paths["/api/stream"], "path /api/stream")
	streamGet := contractMap(t, stream["get"], "path /api/stream get")
	streamMeta := contractMap(t, streamGet["x-neural-necropolis-event-stream"], "path /api/stream x-neural-necropolis-event-stream")
	if got := contractString(t, streamMeta["firstEvent"], "streamMeta.firstEvent"); got != "snapshot" {
		t.Fatalf("path /api/stream firstEvent = %q, want snapshot", got)
	}
}

func TestPublicAPIContractListsCurrentPublicRoutes(t *testing.T) {
	doc := readPublicContract(t)
	paths := contractMap(t, doc["paths"], "paths")
	expected := map[string][]string{
		"/api/health":                    {"get"},
		"/api/dashboard":                 {"get"},
		"/api/boards":                    {"get"},
		"/api/boards/completed":          {"get"},
		"/api/stream":                    {"get"},
		"/api/heroes/register":           {"post"},
		"/api/heroes/{heroId}/observe":   {"get"},
		"/api/heroes/{heroId}/act":       {"post"},
		"/api/heroes/{heroId}/heartbeat": {"post"},
		"/api/heroes/{heroId}/log":       {"post"},
		"/api/leaderboard":               {"get"},
		"/api/seed":                      {"get"},
	}

	for path, methods := range expected {
		entry := contractMap(t, paths[path], "path "+path)
		for _, method := range methods {
			if _, ok := entry[method]; !ok {
				t.Fatalf("contract path %s missing method %s", path, method)
			}
		}
	}
	if _, ok := paths["/api/admin/start"]; ok {
		t.Fatal("admin route leaked into public contract")
	}
}

func TestPublicAPIContractSchemasMatchLiveResponses(t *testing.T) {
	s := newHTTPTestServer()
	doc := readPublicContract(t)
	reg := registerHTTPTestHero(t, s, "hero-contract")
	sessionToken, _ := reg["sessionToken"].(string)

	registerRec := performPlayerRequest(t, s.handleRegister, "POST", "/api/heroes/register", `{"id":"hero-contract-2","name":"HeroContractTwo","strategy":"test strategy","preferredTrait":"curious"}`, "")
	registerPayload := decodeJSONMap(t, registerRec)
	assertJSONHasRequiredKeys(t, registerPayload, contractRequiredFields(t, doc, "RegisterResponse"), "register response")

	observeRec := performPlayerRequest(t, s.handleHeroRoutes, "GET", "/api/heroes/hero-contract/observe", "", sessionToken)
	observePayload := decodeJSONMap(t, observeRec)
	assertJSONHasRequiredKeys(t, observePayload, contractRequiredFields(t, doc, "ObserveResponse"), "observe response")

	heartbeatRec := performPlayerRequest(t, s.handleHeroRoutes, "POST", "/api/heroes/hero-contract/heartbeat", "", sessionToken)
	heartbeatPayload := decodeJSONMap(t, heartbeatRec)
	assertJSONHasRequiredKeys(t, heartbeatPayload, contractRequiredFields(t, doc, "HeartbeatResponse"), "heartbeat response")

	actionRec := performPlayerRequest(t, s.handleHeroRoutes, "POST", "/api/heroes/hero-contract/act", `{"kind":"wait"}`, sessionToken)
	actionPayload := decodeJSONMap(t, actionRec)
	assertJSONHasRequiredKeys(t, actionPayload, contractRequiredFields(t, doc, "ActionResponse"), "action response")

	s.turnPhase = game.PhaseResolve
	conflictRec := performPlayerRequest(t, s.handleHeroRoutes, "POST", "/api/heroes/hero-contract/act", `{"kind":"wait"}`, sessionToken)
	conflictPayload := decodeJSONMap(t, conflictRec)
	assertJSONHasRequiredKeys(t, conflictPayload, contractRequiredFields(t, doc, "ActionConflictResponse"), "action conflict response")

	logRec := performPlayerRequest(t, s.handleHeroRoutes, "POST", "/api/heroes/hero-contract/log", `{"message":"contract check"}`, sessionToken)
	logPayload := decodeJSONMap(t, logRec)
	assertJSONHasRequiredKeys(t, logPayload, contractRequiredFields(t, doc, "LogResponse"), "log response")

	badLogRec := performPlayerRequest(t, s.handleHeroRoutes, "POST", "/api/heroes/hero-contract/log", `{"message":"   "}`, sessionToken)
	badLogPayload := decodeJSONMap(t, badLogRec)
	assertJSONHasRequiredKeys(t, badLogPayload, contractRequiredFields(t, doc, "LogErrorResponse"), "log error response")

	healthRec := performRequest(t, s.handleHealth, "GET", "/api/health", "")
	healthPayload := decodeJSONMap(t, healthRec)
	assertJSONHasRequiredKeys(t, healthPayload, contractRequiredFields(t, doc, "HealthResponse"), "health response")

	dashboardRec := performRequest(t, s.handleDashboardAPI, "GET", "/api/dashboard", "")
	dashboardPayload := decodeJSONMap(t, dashboardRec)
	assertJSONHasRequiredKeys(t, dashboardPayload, contractRequiredFields(t, doc, "DashboardResponse"), "dashboard response")

	boardsRec := performRequest(t, s.handleBoards, "GET", "/api/boards", "")
	boardsPayload := decodeJSONMap(t, boardsRec)
	assertJSONHasRequiredKeys(t, boardsPayload, contractRequiredFields(t, doc, "ManagerSnapshot"), "boards response")

	leaderboardRec := performRequest(t, s.handleLeaderboard, "GET", "/api/leaderboard", "")
	leaderboardPayload := decodeJSONMap(t, leaderboardRec)
	assertJSONHasRequiredKeys(t, leaderboardPayload, contractRequiredFields(t, doc, "LeaderboardResponse"), "leaderboard response")

	seedRec := performRequest(t, s.handleSeed, "GET", "/api/seed", "")
	seedPayload := decodeJSONMap(t, seedRec)
	assertJSONHasRequiredKeys(t, seedPayload, contractRequiredFields(t, doc, "SeedResponse"), "seed response")
}
