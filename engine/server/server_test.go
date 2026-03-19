package server

import (
	"fmt"
	"reflect"
	"strings"
	"testing"
	"time"
	"unsafe"

	"github.com/mmorph/engine/game"
)

func boardStateForTest(board *game.Board) *game.BoardState {
	field := reflect.ValueOf(board).Elem().FieldByName("state")
	return reflect.NewAt(field.Type(), unsafe.Pointer(field.UnsafeAddr())).Elem().Interface().(*game.BoardState)
}

func TestTryAutoStartBoardRespectsGlobalWarmup(t *testing.T) {
	s := &Server{
		mgr:        game.NewManager(),
		planningMs: 1000,
		actionMs:   1000,
		warmupMs:   10000,
	}
	s.startUnlockAt = time.Now().Add(5 * time.Second)

	for i := 0; i < game.CFG.MinBotsToStart; i++ {
		_, _, err := s.mgr.RegisterHero(game.HeroRegistration{
			ID:       game.EntityID(fmt.Sprintf("hero-%d", i)),
			Name:     fmt.Sprintf("Hero-%d", i),
			Strategy: "test strategy",
		})
		if err != nil {
			t.Fatalf("register hero %d: %v", i, err)
		}
	}

	if board, started := s.tryAutoStartBoard(); started || board != nil {
		t.Fatalf("auto-start triggered during global warmup: started=%v board=%v", started, board)
	}

	turnState := s.getTurnState(s.mgr.ActiveBoard())
	if turnState.WarmupRemainingMs <= 0 {
		t.Fatalf("expected positive warmup remaining during lock, got %d", turnState.WarmupRemainingMs)
	}

	s.mu.Lock()
	s.startUnlockAt = time.Now().Add(-1 * time.Second)
	s.mu.Unlock()

	board, started := s.tryAutoStartBoard()
	if !started || board == nil {
		t.Fatalf("expected auto-start after warmup unlock, got started=%v board=%v", started, board)
	}
	if board.Lifecycle() != game.LifecycleRunning {
		t.Fatalf("board lifecycle = %s, want %s", board.Lifecycle(), game.LifecycleRunning)
	}
}

func TestFormatWindowMs(t *testing.T) {
	tests := []struct {
		name string
		ms   int
		want string
	}{
		{name: "whole seconds", ms: 8000, want: "8s"},
		{name: "half second", ms: 500, want: "0.5s"},
		{name: "quarter second precision", ms: 1250, want: "1.25s"},
	}

	for _, tt := range tests {
		if got := formatWindowMs(tt.ms); got != tt.want {
			t.Fatalf("%s: formatWindowMs(%d) = %q, want %q", tt.name, tt.ms, got, tt.want)
		}
	}
}

func TestTransitionPhaseFinishesBoardAtTurnLimitWithWinnerSummary(t *testing.T) {
	s := &Server{
		mgr:           game.NewManager(),
		planningMs:    1000,
		actionMs:      1000,
		maxTurns:      2,
		turnPhase:     game.PhaseResolve,
		streamClients: make(map[*sseClient]bool),
	}

	board, _, err := s.mgr.RegisterHero(game.HeroRegistration{
		ID:       game.EntityID("hero-turn-limit"),
		Name:     "TurnLimitHero",
		Strategy: "test strategy",
	})
	if err != nil {
		t.Fatalf("register hero: %v", err)
	}

	board.SetLifecycle(game.LifecycleRunning)
	board.AddSystemEvent("pre-start")

	s.transitionPhase(board)

	if board.Lifecycle() != game.LifecycleCompleted {
		t.Fatalf("board lifecycle = %s, want %s", board.Lifecycle(), game.LifecycleCompleted)
	}
	reason := board.CompletionReason()
	if reason == "" {
		t.Fatalf("completion reason should not be empty")
	}
	if got, want := board.Turn(), 2; got != want {
		t.Fatalf("board turn = %d, want %d", got, want)
	}
	if !strings.Contains(reason, "Turn limit reached (2).") {
		t.Fatalf("completion reason = %q, want turn-limit prefix", reason)
	}
	if !strings.Contains(reason, "Winner: TurnLimitHero with") {
		t.Fatalf("completion reason = %q, want winner summary", reason)
	}
}

func TestTransitionPhaseFinishesBoardWhenAllHeroesDone(t *testing.T) {
	s := &Server{
		mgr:           game.NewManager(),
		planningMs:    1000,
		actionMs:      1000,
		maxTurns:      20,
		turnPhase:     game.PhaseResolve,
		streamClients: make(map[*sseClient]bool),
	}

	board, _, err := s.mgr.RegisterHero(game.HeroRegistration{
		ID:       game.EntityID("hero-all-done"),
		Name:     "FinishedHero",
		Strategy: "test strategy",
	})
	if err != nil {
		t.Fatalf("register hero: %v", err)
	}

	board.SetLifecycle(game.LifecycleRunning)
	board.AddSystemEvent("pre-finish")
	boardState := boardStateForTest(board)
	boardState.Heroes[0].Status = game.StatusEscaped
	boardState.Heroes[0].Score = 50
	boardState.Heroes[0].LastAction = "escaped"

	s.transitionPhase(board)

	if board.Lifecycle() != game.LifecycleCompleted {
		t.Fatalf("board lifecycle = %s, want %s", board.Lifecycle(), game.LifecycleCompleted)
	}
	reason := board.CompletionReason()
	if !strings.Contains(reason, "All heroes have finished.") {
		t.Fatalf("completion reason = %q, want finished prefix", reason)
	}
	if !strings.Contains(reason, "Winner: FinishedHero with") {
		t.Fatalf("completion reason = %q, want winner summary", reason)
	}
}

func TestBoardWinnerSummaryPrefersHighestScoreAcrossMixedEndStates(t *testing.T) {
	s := &Server{
		mgr:           game.NewManager(),
		planningMs:    1000,
		actionMs:      1000,
		streamClients: make(map[*sseClient]bool),
	}

	board, _, err := s.mgr.RegisterHero(game.HeroRegistration{
		ID:       game.EntityID("hero-escaped-winner"),
		Name:     "EscapedWinner",
		Strategy: "test strategy",
	})
	if err != nil {
		t.Fatalf("register first hero: %v", err)
	}
	if _, err := board.RegisterHero(game.HeroRegistration{
		ID:       game.EntityID("hero-dead-loser"),
		Name:     "DeadLoser",
		Strategy: "test strategy",
	}); err != nil {
		t.Fatalf("register second hero: %v", err)
	}

	state := boardStateForTest(board)
	state.Heroes[0].Status = game.StatusEscaped
	state.Heroes[0].Score = 50
	state.Heroes[0].TurnsSurvived = 10
	state.Heroes[1].Status = game.StatusDead
	state.Heroes[1].Score = 4
	state.Heroes[1].TurnsSurvived = 1

	summary := s.boardWinnerSummary(board)
	if !strings.Contains(summary, "Winner: EscapedWinner with") {
		t.Fatalf("winner summary = %q, want EscapedWinner to lead mixed end-state board", summary)
	}
	if strings.Contains(summary, "DeadLoser") {
		t.Fatalf("winner summary = %q, did not expect lower scoring dead hero to win", summary)
	}
}
