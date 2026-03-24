package server

import (
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"time"

	"github.com/mmorph/engine/game"
)

type duelTraceBotAssignment struct {
	SpawnSlot   int    `json:"spawnSlot"`
	BotIndex    int    `json:"botIndex"`
	HeroID      string `json:"heroId"`
	HeroName    string `json:"heroName"`
	Label       string `json:"label"`
	Provider    string `json:"provider"`
	Model       string `json:"model"`
	Strategy    string `json:"strategy"`
	PromptStyle string `json:"promptStyle,omitempty"`
}

type duelTraceSummary struct {
	SavedAt          string                    `json:"savedAt"`
	ArenaID          string                    `json:"arenaId"`
	ArenaName        string                    `json:"arenaName"`
	MatchID          string                    `json:"matchId"`
	DuelIndex        int                       `json:"duelIndex"`
	Winner           string                    `json:"winner"`
	Leaderboard      []game.ScoreTrack         `json:"leaderboard"`
	BotAssignments   []duelTraceBotAssignment  `json:"botAssignments"`
	TokenStats       []game.DuelHeroTokenStats `json:"tokenStats,omitempty"`
	Heroes           []game.HeroProfile        `json:"heroes"`
	Turn             int                       `json:"turn"`
	BoardID          string                    `json:"boardId"`
	Seed             string                    `json:"seed"`
	MaxTurns         int                       `json:"maxTurns"`
	CompletedAt      *int64                    `json:"completedAt,omitempty"`
	CompletionReason string                    `json:"completionReason,omitempty"`
	RecentEvents     []game.EventRecord        `json:"recentEvents"`
}

func (s *Server) arenaTraceRoot(arenaID string) string {
	return filepath.Join(s.arenaResultsDir, arenaID)
}

func (s *Server) arenaMatchTraceRoot(arenaID, matchID string) string {
	return filepath.Join(s.arenaTraceRoot(arenaID), "matches", matchID)
}

func (s *Server) arenaDuelTraceRoot(arenaID, matchID string, duelIndex int) string {
	return filepath.Join(s.arenaMatchTraceRoot(arenaID, matchID), "duels", fmt.Sprintf("%03d", duelIndex))
}

func (s *Server) appendArenaTraceLog(ctx *streamLogContext, formatted string) error {
	if s == nil || ctx == nil || s.arenaResultsDir == "" || ctx.ArenaID == "" {
		return nil
	}

	line := fmt.Sprintf("%s %s\n", time.Now().Format(time.RFC3339Nano), formatted)
	paths := []string{
		filepath.Join(s.arenaTraceRoot(ctx.ArenaID), "arena.log"),
	}
	if ctx.MatchID != "" {
		paths = append(paths, filepath.Join(s.arenaMatchTraceRoot(ctx.ArenaID, ctx.MatchID), "match.log"))
	}
	if ctx.MatchID != "" && ctx.DuelIndex != nil {
		paths = append(paths, filepath.Join(s.arenaDuelTraceRoot(ctx.ArenaID, ctx.MatchID, *ctx.DuelIndex), "trace.log"))
	}

	for _, path := range paths {
		if err := appendTextFile(path, line); err != nil {
			return err
		}
	}

	return nil
}

func (s *Server) persistArenaArtifacts(arena *game.Arena, matchID string, duelIndex int, finalSnap game.BoardSnapshot, allEvents []game.EventRecord) error {
	if s == nil || arena == nil || s.arenaResultsDir == "" {
		return nil
	}

	arenaSnapshot := arena.Snapshot()
	if err := writeJSONFile(filepath.Join(s.arenaTraceRoot(arenaSnapshot.ID), "summary.json"), struct {
		SavedAt string             `json:"savedAt"`
		Arena   game.ArenaSnapshot `json:"arena"`
	}{
		SavedAt: time.Now().Format(time.RFC3339Nano),
		Arena:   arenaSnapshot,
	}); err != nil {
		return err
	}

	var matchSnapshot *game.ArenaMatchSnapshot
	for i := range arenaSnapshot.Matches {
		if arenaSnapshot.Matches[i].ID == matchID {
			matchSnapshot = &arenaSnapshot.Matches[i]
			break
		}
	}
	if matchSnapshot == nil {
		return nil
	}

	if err := writeJSONFile(filepath.Join(s.arenaMatchTraceRoot(arenaSnapshot.ID, matchSnapshot.ID), "summary.json"), struct {
		SavedAt string                  `json:"savedAt"`
		ArenaID string                  `json:"arenaId"`
		Match   game.ArenaMatchSnapshot `json:"match"`
	}{
		SavedAt: time.Now().Format(time.RFC3339Nano),
		ArenaID: arenaSnapshot.ID,
		Match:   *matchSnapshot,
	}); err != nil {
		return err
	}

	if duelIndex < 0 || duelIndex >= len(matchSnapshot.Duels) {
		return nil
	}
	duel := matchSnapshot.Duels[duelIndex]
	assignments := make([]duelTraceBotAssignment, 0, len(duel.HeroAssignments))
	for _, assignment := range duel.HeroAssignments {
		traceAssignment := duelTraceBotAssignment{
			SpawnSlot: assignment.SpawnSlot,
			BotIndex:  assignment.BotIndex,
			HeroID:    assignment.HeroID,
			HeroName:  assignment.HeroName,
		}
		if assignment.BotIndex >= 0 && assignment.BotIndex < len(arenaSnapshot.Bots) {
			bot := arenaSnapshot.Bots[assignment.BotIndex]
			traceAssignment.Label = bot.Label
			traceAssignment.Provider = bot.Provider
			traceAssignment.Model = bot.Model
			traceAssignment.Strategy = bot.Strategy
			traceAssignment.PromptStyle = bot.PromptStyle
		}
		assignments = append(assignments, traceAssignment)
	}

	duelSummary := duelTraceSummary{
		SavedAt:          time.Now().Format(time.RFC3339Nano),
		ArenaID:          arenaSnapshot.ID,
		ArenaName:        arenaSnapshot.Name,
		MatchID:          matchSnapshot.ID,
		DuelIndex:        duel.DuelIndex,
		Winner:           leaderboardWinner(duel.Leaderboard),
		Leaderboard:      duel.Leaderboard,
		BotAssignments:   assignments,
		TokenStats:       duel.TokenStats,
		Heroes:           finalSnap.Heroes,
		Turn:             finalSnap.World.Turn,
		BoardID:          duel.BoardID,
		Seed:             duel.Seed,
		MaxTurns:         duel.MaxTurns,
		CompletedAt:      duel.CompletedAt,
		CompletionReason: finalSnap.Lobby.CompletionReason,
		RecentEvents:     finalSnap.RecentEvents,
	}
	duelRoot := s.arenaDuelTraceRoot(arenaSnapshot.ID, matchSnapshot.ID, duel.DuelIndex)
	if err := writeJSONFile(filepath.Join(duelRoot, "summary.json"), duelSummary); err != nil {
		return err
	}
	if err := writeJSONFile(filepath.Join(duelRoot, "final-board.json"), finalSnap); err != nil {
		return err
	}
	if err := writeJSONFile(filepath.Join(duelRoot, "events.json"), allEvents); err != nil {
		return err
	}

	return nil
}

func (s *Server) persistArenaPromptTrace(ctx *streamLogContext, trace *arenaPromptTrace) error {
	if s == nil || ctx == nil || trace == nil || s.arenaResultsDir == "" || ctx.ArenaID == "" || ctx.MatchID == "" || ctx.DuelIndex == nil {
		return nil
	}

	trace.SavedAt = time.Now().Format(time.RFC3339Nano)
	trace.ArenaID = ctx.ArenaID
	trace.MatchID = ctx.MatchID
	trace.DuelIndex = *ctx.DuelIndex
	if trace.BoardID == "" {
		trace.BoardID = ctx.BoardID
	}

	path := filepath.Join(
		s.arenaDuelTraceRoot(ctx.ArenaID, ctx.MatchID, *ctx.DuelIndex),
		"prompts",
		fmt.Sprintf("turn-%04d", trace.Turn),
		fmt.Sprintf("%s.json", sanitizeTraceFileComponent(trace.HeroID)),
	)

	return writeJSONFile(path, trace)
}

func sanitizeTraceFileComponent(value string) string {
	value = strings.TrimSpace(value)
	if value == "" {
		return "unknown"
	}
	value = strings.ReplaceAll(value, string(filepath.Separator), "_")
	value = strings.ReplaceAll(value, "/", "_")
	return value
}

func writeJSONFile(path string, payload interface{}) error {
	if err := os.MkdirAll(filepath.Dir(path), 0o755); err != nil {
		return err
	}
	data, err := json.MarshalIndent(payload, "", "  ")
	if err != nil {
		return err
	}
	data = append(data, '\n')
	return os.WriteFile(path, data, 0o644)
}

func appendTextFile(path string, content string) error {
	if err := os.MkdirAll(filepath.Dir(path), 0o755); err != nil {
		return err
	}
	file, err := os.OpenFile(path, os.O_APPEND|os.O_CREATE|os.O_WRONLY, 0o644)
	if err != nil {
		return err
	}
	defer file.Close()
	_, err = file.WriteString(content)
	return err
}
