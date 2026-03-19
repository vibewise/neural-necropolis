package game

import (
	"fmt"
	"testing"
)

func TestManagerRegisterHeroDistributesAcrossBoards(t *testing.T) {
	oldQueueSize := CFG.PreparedBoardQueue
	oldMaxBots := CFG.MaxBotsPerBoard
	CFG.PreparedBoardQueue = 6
	CFG.MaxBotsPerBoard = 4
	t.Cleanup(func() {
		CFG.PreparedBoardQueue = oldQueueSize
		CFG.MaxBotsPerBoard = oldMaxBots
	})

	mgr := NewManager()

	for i := 0; i < 10; i++ {
		board, hero, err := mgr.RegisterHero(HeroRegistration{
			ID:       EntityID(fmt.Sprintf("hero-%d", i)),
			Name:     fmt.Sprintf("Hero-%d", i),
			Strategy: "test strategy",
		})
		if err != nil {
			t.Fatalf("register hero %d: %v", i, err)
		}
		if board == nil || hero == nil {
			t.Fatalf("register hero %d returned nil board or hero", i)
		}
	}

	boards := mgr.AllBoards()
	if len(boards) < 3 {
		t.Fatalf("expected at least 3 boards, got %d", len(boards))
	}

	got := []int{
		boards[0].HeroCount(),
		boards[1].HeroCount(),
		boards[2].HeroCount(),
	}
	want := []int{4, 4, 2}
	for i := range want {
		if got[i] != want[i] {
			t.Fatalf("board %d hero count = %d, want %d (all counts: %v)", i+1, got[i], want[i], got)
		}
	}
}
