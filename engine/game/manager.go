package game

import (
	"errors"
	"fmt"
	"sync"
	"time"
)

// Manager coordinates multiple concurrent boards.
type Manager struct {
	mu        sync.RWMutex
	boards    map[string]*Board // boardID → Board
	order     []string          // insertion order for listing
	queueSize int
	rng       *Rng
}

func NewManager() *Manager {
	m := &Manager{
		boards:    make(map[string]*Board),
		queueSize: CFG.PreparedBoardQueue,
		rng:       NewRng(fmt.Sprintf("manager-%d", time.Now().UnixNano())),
	}
	m.EnsureOpenBoard()
	return m
}

func (m *Manager) createBoardLocked(lifecycle BoardLifecycle) *Board {
	id := GenerateBoardID(m.rng)
	seed := fmt.Sprintf("%s-%d", id, time.Now().UnixNano())
	b := NewBoard(id, seed, CFG.MaxBotsPerBoard)
	b.SetLifecycle(lifecycle)
	if lifecycle == LifecycleQueued {
		b.AddSystemEvent(fmt.Sprintf("Board %s prepared and queued for a future run.", id))
	} else {
		b.AddSystemEvent(fmt.Sprintf("Board %s opened — waiting for heroes.", id))
	}
	m.boards[id] = b
	m.order = append(m.order, id)
	return b
}

func (m *Manager) refillQueueLocked() *Board {
	var openBoard *Board
	pendingCount := 0
	for _, id := range m.order {
		b := m.boards[id]
		if b.Lifecycle() == LifecycleCompleted {
			continue
		}
		pendingCount++
		if b.Lifecycle() == LifecycleOpen && openBoard == nil {
			openBoard = b
		}
	}

	if openBoard == nil {
		for _, id := range m.order {
			b := m.boards[id]
			if b.Lifecycle() == LifecycleQueued {
				b.SetLifecycle(LifecycleOpen)
				b.AddSystemEvent(fmt.Sprintf("Board %s is now open for heroes.", b.ID))
				openBoard = b
				break
			}
		}
	}

	for pendingCount < m.queueSize {
		lifecycle := LifecycleQueued
		if openBoard == nil {
			lifecycle = LifecycleOpen
		}
		created := m.createBoardLocked(lifecycle)
		pendingCount++
		if lifecycle == LifecycleOpen {
			openBoard = created
		}
	}

	return openBoard
}

// EnsureOpenBoard creates a new open board if none exists.
func (m *Manager) EnsureOpenBoard() *Board {
	m.mu.Lock()
	defer m.mu.Unlock()
	return m.refillQueueLocked()
}

func (m *Manager) boardHasRoomLocked(b *Board) bool {
	b.mu.RLock()
	defer b.mu.RUnlock()
	return b.maxHeroes <= 0 || len(b.state.Heroes) < b.maxHeroes
}

// GetBoard retrieves a board by ID.
func (m *Manager) GetBoard(boardID string) *Board {
	m.mu.RLock()
	defer m.mu.RUnlock()
	return m.boards[boardID]
}

// GetRegistrationBoard returns the earliest open board with room, promoting queued boards as needed.
func (m *Manager) GetRegistrationBoard() *Board {
	m.mu.Lock()
	defer m.mu.Unlock()

	for {
		for _, id := range m.order {
			b := m.boards[id]
			if b.Lifecycle() == LifecycleOpen && m.boardHasRoomLocked(b) {
				return b
			}
		}

		promoted := false
		for _, id := range m.order {
			b := m.boards[id]
			if b.Lifecycle() == LifecycleQueued {
				b.SetLifecycle(LifecycleOpen)
				b.AddSystemEvent(fmt.Sprintf("Board %s is now open for heroes.", b.ID))
				promoted = true
				break
			}
		}

		if !promoted {
			created := m.createBoardLocked(LifecycleOpen)
			m.refillQueueLocked()
			return created
		}

		m.refillQueueLocked()
	}
}

// RegisterHero assigns a hero to the earliest open board with room.
// The selection and registration happen under the manager lock so bursts of
// concurrent registrations still distribute predictably across boards.
func (m *Manager) RegisterHero(input HeroRegistration) (*Board, *HeroProfile, error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	now := time.Now()

	for {
		for _, id := range m.order {
			b := m.boards[id]
			if b.Lifecycle() != LifecycleOpen {
				continue
			}

			hero, err := b.RegisterHero(input)
			if err == nil {
				_, armed, immediate := b.RecalculateAutoStartAfter(now)
				if armed {
					b.AddSystemEvent(fmt.Sprintf("Board will auto-start in %.1fs unless the lobby fills first.", float64(CFG.BoardJoinWindowMs)/1000))
				} else if immediate {
					b.AddSystemEvent(fmt.Sprintf("Board reached %d heroes and can start immediately.", CFG.MinBotsToStart))
				}
				return b, hero, nil
			}
			if errors.Is(err, ErrHeroCapacityReached) {
				continue
			}
			return nil, nil, err
		}

		promoted := false
		for _, id := range m.order {
			b := m.boards[id]
			if b.Lifecycle() == LifecycleQueued {
				b.SetLifecycle(LifecycleOpen)
				b.AddSystemEvent(fmt.Sprintf("Board %s is now open for heroes.", b.ID))
				promoted = true
				break
			}
		}

		if !promoted {
			created := m.createBoardLocked(LifecycleOpen)
			m.refillQueueLocked()
			hero, err := created.RegisterHero(input)
			if err != nil {
				return nil, nil, err
			}
			deadline, armed, immediate := created.RecalculateAutoStartAfter(now)
			_ = deadline
			if armed {
				created.AddSystemEvent(fmt.Sprintf("Board will auto-start in %.1fs unless the lobby fills first.", float64(CFG.BoardJoinWindowMs)/1000))
			} else if immediate {
				created.AddSystemEvent(fmt.Sprintf("Board reached %d heroes and can start immediately.", CFG.MinBotsToStart))
			}
			return created, hero, nil
		}

		m.refillQueueLocked()
	}
}

// AllBoards returns boards in insertion order.
func (m *Manager) AllBoards() []*Board {
	m.mu.RLock()
	defer m.mu.RUnlock()
	result := make([]*Board, 0, len(m.order))
	for _, id := range m.order {
		result = append(result, m.boards[id])
	}
	return result
}

// RecordExternalBoard stores a board that was produced outside the continuous
// registration flow, such as an arena duel board, so it can be inspected via
// the regular dashboard and completed-board APIs.
func (m *Manager) RecordExternalBoard(board *Board) {
	if board == nil {
		return
	}

	m.mu.Lock()
	defer m.mu.Unlock()

	if _, exists := m.boards[board.ID]; exists {
		m.boards[board.ID] = board
		return
	}

	m.boards[board.ID] = board
	m.order = append(m.order, board.ID)
}

// ActiveBoard returns the most interesting board to display:
// running > open > most recent completed.
func (m *Manager) ActiveBoard() *Board {
	m.mu.RLock()
	defer m.mu.RUnlock()

	var running, open, lastCompleted *Board
	var queued *Board
	for i := len(m.order) - 1; i >= 0; i-- {
		b := m.boards[m.order[i]]
		switch b.Lifecycle() {
		case LifecycleRunning:
			if running == nil {
				running = b
			}
		case LifecycleOpen:
			if open == nil {
				open = b
			}
		case LifecycleQueued:
			if queued == nil {
				queued = b
			}
		case LifecycleCompleted:
			if lastCompleted == nil {
				lastCompleted = b
			}
		}
	}

	if running != nil {
		return running
	}
	if open != nil {
		return open
	}
	if queued != nil {
		return queued
	}
	return lastCompleted
}

// TryAutoStart checks if the open board has enough heroes and starts it.
// Returns true if a board was started.
func (m *Manager) TryAutoStart() (*Board, bool) {
	m.mu.Lock()
	defer m.mu.Unlock()

	for _, id := range m.order {
		if m.boards[id].Lifecycle() == LifecycleRunning {
			return nil, false
		}
	}

	for _, id := range m.order {
		b := m.boards[id]
		if b.Lifecycle() != LifecycleOpen {
			continue
		}
		b.mu.RLock()
		canStart := b.canAutoStartLocked(time.Now())
		heroCount := len(b.state.Heroes)
		b.mu.RUnlock()

		if canStart {
			b.SetLifecycle(LifecycleRunning)
			b.SetAutoStartAfter(time.Time{})
			b.SetCompletionReason("")
			b.AddSystemEvent(fmt.Sprintf("Board started with %d heroes!", heroCount))
			m.refillQueueLocked()
			return b, true
		}
	}
	return nil, false
}

// CompleteBoard marks a board as completed and ensures a new open board exists.
func (m *Manager) CompleteBoard(boardID string, reason string) {
	m.mu.Lock()
	defer m.mu.Unlock()

	b := m.boards[boardID]
	if b == nil {
		return
	}
	b.SetLifecycle(LifecycleCompleted)
	b.SetCompletionReason(reason)
	if reason != "" {
		b.AddSystemEvent(reason)
	} else {
		b.AddSystemEvent("Board completed.")
	}
	m.refillQueueLocked()
}

// FindBoardForHero locates which board a hero is on.
func (m *Manager) FindBoardForHero(heroID string) *Board {
	m.mu.RLock()
	defer m.mu.RUnlock()

	for i := len(m.order) - 1; i >= 0; i-- {
		id := m.order[i]
		b := m.boards[id]
		if b.Lifecycle() == LifecycleCompleted {
			continue
		}
		b.mu.RLock()
		for _, h := range b.state.Heroes {
			if h.ID == heroID {
				b.mu.RUnlock()
				return b
			}
		}
		b.mu.RUnlock()
	}

	for i := len(m.order) - 1; i >= 0; i-- {
		id := m.order[i]
		b := m.boards[id]
		b.mu.RLock()
		for _, h := range b.state.Heroes {
			if h.ID == heroID {
				b.mu.RUnlock()
				return b
			}
		}
		b.mu.RUnlock()
	}
	return nil
}

// ManagerSnapshot builds a summary of all boards.
func (m *Manager) Snapshot() ManagerSnapshot {
	m.mu.RLock()
	defer m.mu.RUnlock()

	summaries := make([]BoardSummary, 0, len(m.order))
	for _, id := range m.order {
		b := m.boards[id]
		b.mu.RLock()
		heroCount := len(b.state.Heroes)
		joinWindowRemainingMs := int64(0)
		queueStatus := "waiting for queue"
		switch b.lifecycle {
		case LifecycleQueued:
			queueStatus = "queued for another run"
		case LifecycleRunning:
			queueStatus = "running"
		case LifecycleCompleted:
			queueStatus = "completed"
		default:
			if heroCount == 0 {
				queueStatus = "waiting for heroes"
			} else if heroCount >= CFG.MinBotsToStart {
				queueStatus = "ready to start"
			} else if !b.autoStartAfter.IsZero() && time.Now().Before(b.autoStartAfter) {
				queueStatus = "waiting for more heroes"
				joinWindowRemainingMs = time.Until(b.autoStartAfter).Milliseconds()
				if joinWindowRemainingMs < 0 {
					joinWindowRemainingMs = 0
				}
			} else if heroCount >= CFG.MinBotsAfterWait {
				queueStatus = "ready to start"
			} else {
				queueStatus = "waiting for more heroes"
			}
		}
		summaries = append(summaries, BoardSummary{
			BoardID:               b.ID,
			BoardSlug:             MakeBoardSlug(b.state.DungeonName, b.ID),
			BoardName:             b.state.DungeonName,
			Status:                b.lifecycle,
			QueueStatus:           queueStatus,
			JoinWindowRemainingMs: joinWindowRemainingMs,
			HeroCount:             heroCount,
			MaxHeroes:             b.maxHeroes,
			Turn:                  b.state.Turn,
			Seed:                  b.state.Seed,
			CompletionReason:      b.completionReason,
		})
		b.mu.RUnlock()
	}

	return ManagerSnapshot{Boards: summaries}
}
