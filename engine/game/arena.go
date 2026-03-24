package game

import (
	"fmt"
	"sync"
	"time"
)

// ── Arena status ──

type ArenaStatus string

const (
	ArenaStatusPending  ArenaStatus = "pending"  // created, awaiting start
	ArenaStatusRunning  ArenaStatus = "running"  // duels in progress
	ArenaStatusComplete ArenaStatus = "complete" // all matches finished
)

// ── Match status ──

type MatchStatus string

const (
	MatchStatusPending  MatchStatus = "pending"  // not yet started
	MatchStatusRunning  MatchStatus = "running"  // duels in progress
	MatchStatusComplete MatchStatus = "complete" // all duels finished
)

// ── Duel status ──

type DuelStatus string

const (
	DuelStatusPending  DuelStatus = "pending"
	DuelStatusRunning  DuelStatus = "running"
	DuelStatusComplete DuelStatus = "complete"
)

// ── Bot configuration for arena ──

type ArenaBotConfig struct {
	Label           string  `json:"label"`
	Provider        string  `json:"provider"`
	Model           string  `json:"model"`
	Strategy        string  `json:"strategy"` // e.g. "berserker", "explorer", "treasure-hunter"
	PromptStyle     string  `json:"promptStyle,omitempty"`
	MaxOutputTokens int     `json:"maxOutputTokens"` // 0 → default 180
	Temperature     float64 `json:"temperature"`     // 0 → default 0.7
	ReasoningEffort string  `json:"reasoningEffort,omitempty"`
}

// DuelHeroTokenStats tracks LLM token usage for one hero in a duel.
type DuelHeroTokenStats struct {
	HeroID           string `json:"heroId"`
	BotIndex         int    `json:"botIndex"`
	PromptTokens     int    `json:"promptTokens"`
	CompletionTokens int    `json:"completionTokens"`
	TotalTokens      int    `json:"totalTokens"`
	LLMCalls         int    `json:"llmCalls"`
	Fallbacks        int    `json:"fallbacks"`
}

// DuelHeroAssignment records which configured bot controlled a specific hero.
type DuelHeroAssignment struct {
	HeroID    string `json:"heroId"`
	HeroName  string `json:"heroName"`
	BotIndex  int    `json:"botIndex"`
	SpawnSlot int    `json:"spawnSlot"`
}

// ── Duel result ──

type DuelResult struct {
	DuelIndex       int                  `json:"duelIndex"`
	Status          DuelStatus           `json:"status"`
	BoardID         string               `json:"boardId"`
	Seed            string               `json:"seed"`
	MaxTurns        int                  `json:"maxTurns"`
	Leaderboard     []ScoreTrack         `json:"leaderboard"`
	TurnReached     int                  `json:"turnReached"`
	CompletedAt     *int64               `json:"completedAt,omitempty"`
	BotPositions    []int                `json:"botPositions"` // which bot config index got which spawn slot
	HeroAssignments []DuelHeroAssignment `json:"heroAssignments,omitempty"`
	TokenStats      []DuelHeroTokenStats `json:"tokenStats,omitempty"`
}

// ── Match ──

type ArenaMatch struct {
	ID         string       `json:"id"`
	Status     MatchStatus  `json:"status"`
	Seed       string       `json:"seed"`
	MaxTurns   int          `json:"maxTurns"`
	DuelCount  int          `json:"duelCount"` // total duels in this match
	Duels      []DuelResult `json:"duels"`
	CreatedAt  int64        `json:"createdAt"`
	StartedAt  *int64       `json:"startedAt,omitempty"`
	FinishedAt *int64       `json:"finishedAt,omitempty"`
}

// ── Arena ──

type Arena struct {
	mu sync.RWMutex

	ID         string           `json:"id"`
	Name       string           `json:"name"`
	Status     ArenaStatus      `json:"status"`
	Bots       []ArenaBotConfig `json:"bots"`
	Matches    []ArenaMatch     `json:"matches"`
	CreatedAt  int64            `json:"createdAt"`
	StartedAt  *int64           `json:"startedAt,omitempty"`
	FinishedAt *int64           `json:"finishedAt,omitempty"`

	// How many players (2-N) compete per duel. Defaults to len(Bots).
	PlayersPerDuel int `json:"playersPerDuel"`
}

func (a *Arena) Snapshot() ArenaSnapshot {
	a.mu.RLock()
	defer a.mu.RUnlock()
	return a.snapshotLocked()
}

func (a *Arena) RLockBots()   { a.mu.RLock() }
func (a *Arena) RUnlockBots() { a.mu.RUnlock() }

func (a *Arena) CopyBots() []ArenaBotConfig {
	bots := make([]ArenaBotConfig, len(a.Bots))
	copy(bots, a.Bots)
	return bots
}

func (a *Arena) snapshotLocked() ArenaSnapshot {

	matches := make([]ArenaMatchSnapshot, len(a.Matches))
	for i, m := range a.Matches {
		duels := make([]DuelResult, len(m.Duels))
		copy(duels, m.Duels)
		matches[i] = ArenaMatchSnapshot{
			ID:         m.ID,
			Status:     m.Status,
			Seed:       m.Seed,
			MaxTurns:   m.MaxTurns,
			DuelCount:  m.DuelCount,
			Duels:      duels,
			CreatedAt:  m.CreatedAt,
			StartedAt:  m.StartedAt,
			FinishedAt: m.FinishedAt,
		}
	}

	bots := make([]ArenaBotConfig, len(a.Bots))
	copy(bots, a.Bots)

	return ArenaSnapshot{
		ID:             a.ID,
		Name:           a.Name,
		Status:         a.Status,
		Bots:           bots,
		Matches:        matches,
		CreatedAt:      a.CreatedAt,
		StartedAt:      a.StartedAt,
		FinishedAt:     a.FinishedAt,
		PlayersPerDuel: a.PlayersPerDuel,
		Standings:      a.computeStandingsLocked(),
	}
}

func (a *Arena) computeStandingsLocked() []ArenaBotStanding {
	standings := make([]ArenaBotStanding, len(a.Bots))
	for i, bot := range a.Bots {
		standings[i] = ArenaBotStanding{
			BotIndex: i,
			Label:    bot.Label,
			Provider: bot.Provider,
			Model:    bot.Model,
		}
	}

	for _, match := range a.Matches {
		for _, duel := range match.Duels {
			if duel.Status != DuelStatusComplete {
				continue
			}
			heroToBot := make(map[string]int, len(duel.HeroAssignments))
			for _, assignment := range duel.HeroAssignments {
				heroToBot[assignment.HeroID] = assignment.BotIndex
			}
			for rank, entry := range duel.Leaderboard {
				botIdx, ok := heroToBot[entry.HeroID]
				if !ok && rank < len(duel.BotPositions) {
					botIdx = duel.BotPositions[rank]
				}
				if botIdx >= 0 && botIdx < len(standings) {
					standings[botIdx].TotalScore += entry.TotalScore
					standings[botIdx].DuelsPlayed++
					if rank == 0 {
						standings[botIdx].Wins++
					}
				}
			}
			// Aggregate token stats
			for _, ts := range duel.TokenStats {
				if ts.BotIndex >= 0 && ts.BotIndex < len(standings) {
					standings[ts.BotIndex].TotalPromptTokens += ts.PromptTokens
					standings[ts.BotIndex].TotalCompletionTokens += ts.CompletionTokens
					standings[ts.BotIndex].TotalLLMCalls += ts.LLMCalls
				}
			}
		}
	}

	return standings
}

// ── Arena snapshots for API responses ──

type ArenaBotStanding struct {
	BotIndex              int    `json:"botIndex"`
	Label                 string `json:"label"`
	Provider              string `json:"provider"`
	Model                 string `json:"model"`
	Wins                  int    `json:"wins"`
	DuelsPlayed           int    `json:"duelsPlayed"`
	TotalScore            int    `json:"totalScore"`
	TotalPromptTokens     int    `json:"totalPromptTokens"`
	TotalCompletionTokens int    `json:"totalCompletionTokens"`
	TotalLLMCalls         int    `json:"totalLlmCalls"`
}

type ArenaMatchSnapshot struct {
	ID         string       `json:"id"`
	Status     MatchStatus  `json:"status"`
	Seed       string       `json:"seed"`
	MaxTurns   int          `json:"maxTurns"`
	DuelCount  int          `json:"duelCount"`
	Duels      []DuelResult `json:"duels"`
	CreatedAt  int64        `json:"createdAt"`
	StartedAt  *int64       `json:"startedAt,omitempty"`
	FinishedAt *int64       `json:"finishedAt,omitempty"`
}

type ArenaSnapshot struct {
	ID             string               `json:"id"`
	Name           string               `json:"name"`
	Status         ArenaStatus          `json:"status"`
	Bots           []ArenaBotConfig     `json:"bots"`
	Matches        []ArenaMatchSnapshot `json:"matches"`
	Standings      []ArenaBotStanding   `json:"standings"`
	CreatedAt      int64                `json:"createdAt"`
	StartedAt      *int64               `json:"startedAt,omitempty"`
	FinishedAt     *int64               `json:"finishedAt,omitempty"`
	PlayersPerDuel int                  `json:"playersPerDuel"`
}

type ArenaSummary struct {
	ID             string      `json:"id"`
	Name           string      `json:"name"`
	Status         ArenaStatus `json:"status"`
	BotCount       int         `json:"botCount"`
	MatchCount     int         `json:"matchCount"`
	PlayersPerDuel int         `json:"playersPerDuel"`
	CreatedAt      int64       `json:"createdAt"`
}

// ── Arena Manager ──

type ArenaManager struct {
	mu     sync.RWMutex
	arenas map[string]*Arena
	order  []string
}

func NewArenaManager() *ArenaManager {
	return &ArenaManager{
		arenas: make(map[string]*Arena),
	}
}

type CreateArenaRequest struct {
	Name           string           `json:"name"`
	Bots           []ArenaBotConfig `json:"bots"`
	PlayersPerDuel int              `json:"playersPerDuel,omitempty"`
}

func (am *ArenaManager) CreateArena(req CreateArenaRequest) (*Arena, error) {
	am.mu.Lock()
	defer am.mu.Unlock()

	if len(req.Bots) < 2 {
		return nil, fmt.Errorf("arena requires at least 2 bots")
	}

	players := req.PlayersPerDuel
	if players < 2 {
		players = len(req.Bots)
	}
	if players > len(req.Bots) {
		players = len(req.Bots)
	}

	arena := &Arena{
		ID:             NewID(),
		Name:           req.Name,
		Status:         ArenaStatusPending,
		Bots:           req.Bots,
		Matches:        []ArenaMatch{},
		CreatedAt:      time.Now().UnixMilli(),
		PlayersPerDuel: players,
	}

	am.arenas[arena.ID] = arena
	am.order = append(am.order, arena.ID)
	return arena, nil
}

func (am *ArenaManager) GetArena(id string) *Arena {
	am.mu.RLock()
	defer am.mu.RUnlock()
	return am.arenas[id]
}

func (am *ArenaManager) ListArenas() []ArenaSummary {
	am.mu.RLock()
	defer am.mu.RUnlock()

	summaries := make([]ArenaSummary, 0, len(am.order))
	for _, id := range am.order {
		a := am.arenas[id]
		a.mu.RLock()
		summaries = append(summaries, ArenaSummary{
			ID:             a.ID,
			Name:           a.Name,
			Status:         a.Status,
			BotCount:       len(a.Bots),
			MatchCount:     len(a.Matches),
			PlayersPerDuel: a.PlayersPerDuel,
			CreatedAt:      a.CreatedAt,
		})
		a.mu.RUnlock()
	}
	return summaries
}

type AddMatchRequest struct {
	DuelCount int `json:"duelCount"` // must be even
	MaxTurns  int `json:"maxTurns"`  // rounds per duel; default 100
}

func (am *ArenaManager) AddMatch(arenaID string, req AddMatchRequest) (*ArenaMatch, error) {
	am.mu.RLock()
	arena := am.arenas[arenaID]
	am.mu.RUnlock()

	if arena == nil {
		return nil, fmt.Errorf("arena not found")
	}

	arena.mu.Lock()
	defer arena.mu.Unlock()

	if req.DuelCount < 2 || req.DuelCount%2 != 0 {
		return nil, fmt.Errorf("duelCount must be an even number >= 2")
	}

	maxTurns := req.MaxTurns
	if maxTurns <= 0 {
		maxTurns = 100
	}

	// Generate a single seed for this match — all duels share the same board
	rng := NewRng(fmt.Sprintf("arena-%s-match-%d-%d", arenaID, len(arena.Matches), time.Now().UnixNano()))
	seed := GenerateBoardID(rng) + fmt.Sprintf("-%d", time.Now().UnixNano())

	duels := make([]DuelResult, req.DuelCount)
	botCount := len(arena.Bots)
	for i := range duels {
		// Rotate bot positions each duel so every bot gets each spawn slot equally
		positions := make([]int, botCount)
		for j := 0; j < botCount; j++ {
			positions[j] = (j + i) % botCount
		}
		duels[i] = DuelResult{
			DuelIndex:    i,
			Status:       DuelStatusPending,
			Seed:         seed,
			MaxTurns:     maxTurns,
			BotPositions: positions,
		}
	}

	match := ArenaMatch{
		ID:        NewID(),
		Status:    MatchStatusPending,
		Seed:      seed,
		MaxTurns:  maxTurns,
		DuelCount: req.DuelCount,
		Duels:     duels,
		CreatedAt: time.Now().UnixMilli(),
	}

	arena.Matches = append(arena.Matches, match)
	return &match, nil
}

// StartArena transitions the arena to running. Actual duel execution is handled by the server.
func (am *ArenaManager) StartArena(arenaID string) error {
	am.mu.RLock()
	arena := am.arenas[arenaID]
	am.mu.RUnlock()

	if arena == nil {
		return fmt.Errorf("arena not found")
	}

	arena.mu.Lock()
	defer arena.mu.Unlock()

	if arena.Status != ArenaStatusPending {
		return fmt.Errorf("arena is already %s", arena.Status)
	}

	if len(arena.Matches) == 0 {
		return fmt.Errorf("arena has no matches")
	}

	now := time.Now().UnixMilli()
	arena.Status = ArenaStatusRunning
	arena.StartedAt = &now
	return nil
}

// RecordDuelResult stores the result of a completed duel.
func (am *ArenaManager) RecordDuelResult(arenaID, matchID string, duelIndex int, leaderboard []ScoreTrack, turnReached int, boardID string, tokenStats []DuelHeroTokenStats, heroAssignments []DuelHeroAssignment) error {
	am.mu.RLock()
	arena := am.arenas[arenaID]
	am.mu.RUnlock()

	if arena == nil {
		return fmt.Errorf("arena not found")
	}

	arena.mu.Lock()
	defer arena.mu.Unlock()

	matchIdx := -1
	for i, m := range arena.Matches {
		if m.ID == matchID {
			matchIdx = i
			break
		}
	}
	if matchIdx < 0 {
		return fmt.Errorf("match not found")
	}

	match := &arena.Matches[matchIdx]
	if duelIndex < 0 || duelIndex >= len(match.Duels) {
		return fmt.Errorf("duel index out of range")
	}

	now := time.Now().UnixMilli()
	match.Duels[duelIndex].Status = DuelStatusComplete
	match.Duels[duelIndex].Leaderboard = leaderboard
	match.Duels[duelIndex].TurnReached = turnReached
	match.Duels[duelIndex].CompletedAt = &now
	match.Duels[duelIndex].BoardID = boardID
	match.Duels[duelIndex].TokenStats = tokenStats
	match.Duels[duelIndex].HeroAssignments = heroAssignments

	// Check if all duels are complete
	allDone := true
	for _, d := range match.Duels {
		if d.Status != DuelStatusComplete {
			allDone = false
			break
		}
	}
	if allDone {
		match.Status = MatchStatusComplete
		match.FinishedAt = &now
	}

	// Check if all matches are complete
	allMatchesDone := true
	for _, m := range arena.Matches {
		if m.Status != MatchStatusComplete {
			allMatchesDone = false
			break
		}
	}
	if allMatchesDone && arena.Status == ArenaStatusRunning {
		arena.Status = ArenaStatusComplete
		arena.FinishedAt = &now
	}

	return nil
}

// NextPendingDuel finds the next duel that needs to be run.
// Returns arenaID, matchID, duelIndex, duel, and a bool indicating if one was found.
func (am *ArenaManager) NextPendingDuel(arenaID string) (string, int, *DuelResult, bool) {
	am.mu.RLock()
	arena := am.arenas[arenaID]
	am.mu.RUnlock()

	if arena == nil {
		return "", 0, nil, false
	}

	arena.mu.RLock()
	defer arena.mu.RUnlock()

	if arena.Status != ArenaStatusRunning {
		return "", 0, nil, false
	}

	for _, match := range arena.Matches {
		if match.Status == MatchStatusComplete {
			continue
		}
		for i, duel := range match.Duels {
			if duel.Status == DuelStatusPending {
				d := duel // copy
				return match.ID, i, &d, true
			}
		}
	}
	return "", 0, nil, false
}

// MarkDuelRunning marks a specific duel as in-progress.
func (am *ArenaManager) MarkDuelRunning(arenaID, matchID string, duelIndex int) error {
	am.mu.RLock()
	arena := am.arenas[arenaID]
	am.mu.RUnlock()

	if arena == nil {
		return fmt.Errorf("arena not found")
	}

	arena.mu.Lock()
	defer arena.mu.Unlock()

	for mi, m := range arena.Matches {
		if m.ID == matchID {
			if duelIndex < 0 || duelIndex >= len(m.Duels) {
				return fmt.Errorf("duel index out of range")
			}
			arena.Matches[mi].Duels[duelIndex].Status = DuelStatusRunning
			if arena.Matches[mi].Status == MatchStatusPending {
				arena.Matches[mi].Status = MatchStatusRunning
				now := time.Now().UnixMilli()
				arena.Matches[mi].StartedAt = &now
			}
			return nil
		}
	}
	return fmt.Errorf("match not found")
}
