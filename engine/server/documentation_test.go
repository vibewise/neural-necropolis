package server

import (
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func readSpecDoc(t *testing.T) string {
	t.Helper()
	path := filepath.Join("..", "..", "docs", "SPEC.md")
	content, err := os.ReadFile(path)
	if err != nil {
		t.Fatalf("read spec doc: %v", err)
	}
	return string(content)
}

func requireSpecContainsAll(t *testing.T, doc string, context string, snippets []string) {
	t.Helper()
	for _, snippet := range snippets {
		if !strings.Contains(doc, snippet) {
			t.Fatalf("spec doc missing %s snippet %q", context, snippet)
		}
	}
}

func TestSpecDocListsCurrentPublicEndpoints(t *testing.T) {
	doc := readSpecDoc(t)
	expectedPaths := []string{
		"`/api/health`",
		"`/api/heroes/register`",
		"`/api/heroes/:id/observe`",
		"`/api/heroes/:id/act`",
		"`/api/heroes/:id/log`",
		"`/api/dashboard`",
		"`/api/boards`",
		"`/api/boards/completed`",
		"`/api/stream`",
		"`/api/leaderboard`",
		"`/api/seed`",
	}
	requireSpecContainsAll(t, doc, "public endpoint", expectedPaths)
}

func TestSpecDocMatchesCurrentActionSubmissionRule(t *testing.T) {
	doc := readSpecDoc(t)
	if !strings.Contains(doc, "A hero may have one submitted action per turn.") {
		t.Fatalf("spec doc missing single-action rule")
	}
	if !strings.Contains(doc, "additional submissions in the same turn are rejected") {
		t.Fatalf("spec doc missing rejection wording for later submissions")
	}
	if strings.Contains(doc, "replaces an earlier one") {
		t.Fatalf("spec doc still contains outdated replacement wording")
	}
}

func TestSpecDocIncludesCurrentStartupAndBotGuidance(t *testing.T) {
	doc := readSpecDoc(t)
	requireSpecContainsAll(t, doc, "startup and bot guidance", []string{
		"npm run run:scripted",
		"npm run run:aibots",
		"npm run run:openclaw",
		"npm run run:all",
		"Then open `http://localhost:3000`.",
		"1. register a hero",
		"2. observe the board state",
		"3. choose one legal action",
		"4. submit it during the submit window",
		"5. repeat until the board ends",
		"- local scripted bots: deterministic local processes with no model dependency",
		"- AI bots: model-driven bots that choose among legal actions at runtime",
	})
}

func TestSpecDocIncludesObservationAndRuntimeNotes(t *testing.T) {
	doc := readSpecDoc(t)
	requireSpecContainsAll(t, doc, "observation contract", []string{
		"- hero state",
		"- visible terrain",
		"- visible monsters",
		"- visible heroes",
		"- visible non-hostile characters",
		"- visible floor items",
		"- recent events",
		"- legal actions",
		"Legal actions are authoritative.",
	})
	requireSpecContainsAll(t, doc, "runtime settings", []string{
		"- host and port",
		"- submit window duration",
		"- resolve window duration",
		"- maximum board length",
		"- warm-up before boards auto-start",
	})
}
