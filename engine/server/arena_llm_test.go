package server

import (
	"os"
	"path/filepath"
	"strings"
	"sync"
	"testing"

	"github.com/mmorph/engine/game"
)

func TestResolveProviderReadsKeysFromDotenv(t *testing.T) {
	resetDotenvCacheForTest(t)
	t.Setenv("GROQ_API_KEY", "")
	t.Setenv("OPENAI_API_KEY", "")
	t.Setenv("GROQ_BASE_URL", "")

	tempDir := t.TempDir()
	writeDotenvForTest(t, filepath.Join(tempDir, ".env"), "GROQ_API_KEY=test-groq-key\nGROQ_BASE_URL=https://groq.example.test/v1/\n")
	withWorkingDirectory(t, tempDir)

	baseURL, apiKey, ok := resolveProvider("groq")
	if !ok {
		t.Fatal("resolveProvider returned ok=false, want true")
	}
	if apiKey != "test-groq-key" {
		t.Fatalf("apiKey = %q, want %q", apiKey, "test-groq-key")
	}
	if baseURL != "https://groq.example.test/v1" {
		t.Fatalf("baseURL = %q, want %q", baseURL, "https://groq.example.test/v1")
	}
}

func TestResolveProviderFallsBackToDotenvOpenAIKeyForUnknownProvider(t *testing.T) {
	resetDotenvCacheForTest(t)
	t.Setenv("OPENAI_API_KEY", "")

	tempDir := t.TempDir()
	writeDotenvForTest(t, filepath.Join(tempDir, ".env"), "OPENAI_API_KEY=test-openai-key\n")
	withWorkingDirectory(t, tempDir)

	baseURL, apiKey, ok := resolveProvider("unknown-provider")
	if !ok {
		t.Fatal("resolveProvider returned ok=false, want true")
	}
	if apiKey != "test-openai-key" {
		t.Fatalf("apiKey = %q, want %q", apiKey, "test-openai-key")
	}
	if baseURL != "https://api.openai.com/v1" {
		t.Fatalf("baseURL = %q, want %q", baseURL, "https://api.openai.com/v1")
	}
}

func resetDotenvCacheForTest(t *testing.T) {
	t.Helper()
	dotenvOnce = sync.Once{}
	dotenvVals = nil
	t.Cleanup(func() {
		dotenvOnce = sync.Once{}
		dotenvVals = nil
	})
}

func withWorkingDirectory(t *testing.T, dir string) {
	t.Helper()
	original, err := os.Getwd()
	if err != nil {
		t.Fatalf("getwd: %v", err)
	}
	if err := os.Chdir(dir); err != nil {
		t.Fatalf("chdir to temp dir: %v", err)
	}
	t.Cleanup(func() {
		if err := os.Chdir(original); err != nil {
			t.Fatalf("restore cwd: %v", err)
		}
	})
}

func writeDotenvForTest(t *testing.T, filePath, content string) {
	t.Helper()
	if err := os.WriteFile(filePath, []byte(content), 0o600); err != nil {
		t.Fatalf("write %s: %v", filePath, err)
	}
}

func TestBuildArenaSystemPromptSmartAddsAntiLoopGuidance(t *testing.T) {
	prompt := buildArenaSystemPrompt("smart", "prefer treasure")
	if !strings.Contains(prompt, "Do not repeat the same information-gathering spell") {
		t.Fatalf("smart prompt missing anti-loop guidance: %q", prompt)
	}

	naive := buildArenaSystemPrompt("naive", "prefer treasure")
	if strings.Contains(naive, "Do not repeat the same information-gathering spell") {
		t.Fatalf("naive prompt unexpectedly contains smart anti-loop guidance: %q", naive)
	}
}

func TestBuildArenaUserPromptIncludesSpellDiscoveries(t *testing.T) {
	prompt := buildArenaUserPrompt(&game.VisionData{
		Turn: 7,
		Hero: &game.HeroProfile{
			Name:     "Treasure Mind",
			Stats:    game.HeroStats{Hp: 30, MaxHp: 40, Attack: 5, Defense: 3, Speed: 4, Perception: 6},
			Score:    12,
			Gold:     8,
			Fatigue:  10,
			Morale:   60,
			Position: game.Position{X: 4, Y: 9},
			Status:   game.StatusAlive,
		},
		LegalActions: []game.LegalAction{{Description: "Move east toward treasure"}},
		SpellDiscoveries: []game.SpellDiscovery{{
			Spell:          game.SpellLocateTreasury,
			Positions:      []game.Position{{X: 10, Y: 10}, {X: 12, Y: 3}},
			DiscoveredTurn: 5,
		}},
	})

	if !strings.Contains(prompt, "ACTIVE SPELL DISCOVERIES") {
		t.Fatalf("prompt missing discoveries section: %q", prompt)
	}
	if !strings.Contains(prompt, "locate_treasury discovered on turn 5: 2 positions -> (10,10) d=7, (12,3) d=14") {
		t.Fatalf("prompt missing discovery summary: %q", prompt)
	}
}
