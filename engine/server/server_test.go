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

func TestTryAutoStartBoardRespectsPausedFlag(t *testing.T) {
	s := &Server{
		mgr:          game.NewManager(),
		planningMs:   1000,
		actionMs:     1000,
		gameSettings: game.GameSettings{Paused: true},
	}

	for i := 0; i < game.CFG.MinBotsToStart; i++ {
		_, _, err := s.mgr.RegisterHero(game.HeroRegistration{
			ID:       game.EntityID(fmt.Sprintf("hero-paused-%d", i)),
			Name:     fmt.Sprintf("HeroPaused-%d", i),
			Strategy: "test strategy",
		})
		if err != nil {
			t.Fatalf("register hero %d: %v", i, err)
		}
	}

	if board, started := s.tryAutoStartBoard(); started || board != nil {
		t.Fatalf("auto-start triggered while paused: started=%v board=%v", started, board)
	}

	active := s.mgr.ActiveBoard()
	if active == nil {
		t.Fatal("expected active board while paused")
	}
	if active.Lifecycle() != game.LifecycleOpen {
		t.Fatalf("active board lifecycle = %s, want %s while paused", active.Lifecycle(), game.LifecycleOpen)
	}
}

func TestTryAutoStartBoardWaitsForJoinWindowBeforeStartingSmallLobby(t *testing.T) {
	oldJoinWindow := game.CFG.BoardJoinWindowMs
	oldMinAfterWait := game.CFG.MinBotsAfterWait
	game.CFG.BoardJoinWindowMs = 10_000
	game.CFG.MinBotsAfterWait = 1
	t.Cleanup(func() {
		game.CFG.BoardJoinWindowMs = oldJoinWindow
		game.CFG.MinBotsAfterWait = oldMinAfterWait
	})

	s := &Server{
		mgr:        game.NewManager(),
		planningMs: 1000,
		actionMs:   1000,
	}

	board, _, err := s.mgr.RegisterHero(game.HeroRegistration{
		ID:       game.EntityID("hero-wait"),
		Name:     "WaitHero",
		Strategy: "test strategy",
	})
	if err != nil {
		t.Fatalf("register hero: %v", err)
	}

	deadline := board.AutoStartAfter()
	if deadline.IsZero() {
		t.Fatal("expected join window to be armed for first hero")
	}
	if boardStarted, started := s.tryAutoStartBoard(); started || boardStarted != nil {
		t.Fatalf("auto-start triggered before join window elapsed: started=%v board=%v", started, boardStarted)
	}

	board.SetAutoStartAfter(time.Now().Add(-1 * time.Second))
	boardStarted, started := s.tryAutoStartBoard()
	if !started || boardStarted == nil {
		t.Fatalf("expected auto-start after join window elapsed, got started=%v board=%v", started, boardStarted)
	}
	if boardStarted.Lifecycle() != game.LifecycleRunning {
		t.Fatalf("board lifecycle = %s, want %s", boardStarted.Lifecycle(), game.LifecycleRunning)
	}
}

func TestTryAutoStartBoardStartsImmediatelyWhenLobbyFills(t *testing.T) {
	s := &Server{
		mgr:        game.NewManager(),
		planningMs: 1000,
		actionMs:   1000,
	}

	var board *game.Board
	for i := 0; i < game.CFG.MinBotsToStart; i++ {
		registeredBoard, _, err := s.mgr.RegisterHero(game.HeroRegistration{
			ID:       game.EntityID(fmt.Sprintf("hero-fill-%d", i)),
			Name:     fmt.Sprintf("FillHero-%d", i),
			Strategy: "test strategy",
		})
		if err != nil {
			t.Fatalf("register hero %d: %v", i, err)
		}
		board = registeredBoard
	}

	if deadline := board.AutoStartAfter(); !deadline.IsZero() {
		t.Fatalf("expected full lobby to clear join window, got %v", deadline)
	}
	boardStarted, started := s.tryAutoStartBoard()
	if !started || boardStarted == nil {
		t.Fatalf("expected immediate auto-start for full lobby, got started=%v board=%v", started, boardStarted)
	}
}

func TestTryAutoStartBoardAllowsOnlyOneRunningBoardAtATime(t *testing.T) {
	s := &Server{
		mgr:        game.NewManager(),
		planningMs: 1000,
		actionMs:   1000,
	}

	for i := 0; i < game.CFG.MinBotsToStart; i++ {
		_, _, err := s.mgr.RegisterHero(game.HeroRegistration{
			ID:       game.EntityID(fmt.Sprintf("hero-first-%d", i)),
			Name:     fmt.Sprintf("FirstHero-%d", i),
			Strategy: "test strategy",
		})
		if err != nil {
			t.Fatalf("register first-board hero %d: %v", i, err)
		}
	}

	firstBoard, started := s.tryAutoStartBoard()
	if !started || firstBoard == nil {
		t.Fatalf("expected first board to auto-start, got started=%v board=%v", started, firstBoard)
	}

	var waitingBoard *game.Board
	for i := 0; i < game.CFG.MinBotsToStart; i++ {
		registeredBoard, _, err := s.mgr.RegisterHero(game.HeroRegistration{
			ID:       game.EntityID(fmt.Sprintf("hero-second-%d", i)),
			Name:     fmt.Sprintf("SecondHero-%d", i),
			Strategy: "test strategy",
		})
		if err != nil {
			t.Fatalf("register second-board hero %d: %v", i, err)
		}
		waitingBoard = registeredBoard
	}

	if waitingBoard == nil {
		t.Fatal("expected second board to exist")
	}
	if waitingBoard.ID == firstBoard.ID {
		t.Fatal("expected second batch of heroes to be assigned to a different board")
	}
	if waitingBoard.Lifecycle() != game.LifecycleOpen {
		t.Fatalf("waiting board lifecycle = %s, want %s", waitingBoard.Lifecycle(), game.LifecycleOpen)
	}

	blockedBoard, blockedStart := s.tryAutoStartBoard()
	if blockedStart || blockedBoard != nil {
		t.Fatalf("unexpected second auto-start while another board is running: started=%v board=%v", blockedStart, blockedBoard)
	}

	s.mgr.CompleteBoard(firstBoard.ID, "test completion")
	nextBoard, nextStarted := s.tryAutoStartBoard()
	if !nextStarted || nextBoard == nil {
		t.Fatalf("expected second board to start after first completed, got started=%v board=%v", nextStarted, nextBoard)
	}
	if nextBoard.ID != waitingBoard.ID {
		t.Fatalf("started board id = %s, want %s", nextBoard.ID, waitingBoard.ID)
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
