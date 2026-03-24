package game

import "testing"

func TestArenaStandingsUseHeroAssignmentsInsteadOfLeaderboardRank(t *testing.T) {
	arena := &Arena{
		Bots: []ArenaBotConfig{
			{Label: "Treasure Mind A", Provider: "openai", Model: "gpt-4o"},
			{Label: "Berserker B", Provider: "openai", Model: "gpt-4o"},
		},
		Matches: []ArenaMatch{{
			Duels: []DuelResult{{
				Status:       DuelStatusComplete,
				BotPositions: []int{0, 1},
				HeroAssignments: []DuelHeroAssignment{
					{HeroID: "hero-a", HeroName: "Treasure Mind A", BotIndex: 0, SpawnSlot: 0},
					{HeroID: "hero-b", HeroName: "Berserker B", BotIndex: 1, SpawnSlot: 1},
				},
				Leaderboard: []ScoreTrack{
					{HeroID: "hero-b", HeroName: "Berserker B", TotalScore: 31},
					{HeroID: "hero-a", HeroName: "Treasure Mind A", TotalScore: 22},
				},
			}},
		}},
	}

	standings := arena.computeStandingsLocked()
	if standings[1].Wins != 1 {
		t.Fatalf("bot 1 wins = %d, want 1", standings[1].Wins)
	}
	if standings[0].Wins != 0 {
		t.Fatalf("bot 0 wins = %d, want 0", standings[0].Wins)
	}
	if standings[1].TotalScore != 31 {
		t.Fatalf("bot 1 total score = %d, want 31", standings[1].TotalScore)
	}
	if standings[0].TotalScore != 22 {
		t.Fatalf("bot 0 total score = %d, want 22", standings[0].TotalScore)
	}
}
