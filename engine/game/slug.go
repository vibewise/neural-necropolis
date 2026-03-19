package game

import (
	"fmt"
	"strings"
	"unicode"
)

func normalizeSlugPart(input string, fallback string) string {
	trimmed := strings.TrimSpace(strings.ToLower(input))
	if trimmed == "" {
		return fallback
	}

	var b strings.Builder
	lastDash := false
	for _, r := range trimmed {
		if unicode.IsLetter(r) || unicode.IsDigit(r) {
			b.WriteRune(r)
			lastDash = false
			continue
		}
		if !lastDash {
			b.WriteByte('-')
			lastDash = true
		}
	}

	out := strings.Trim(b.String(), "-")
	if out == "" {
		return fallback
	}
	return out
}

func shortSlugID(id string) string {
	id = normalizeSlugPart(id, "id")
	if len(id) <= 6 {
		return id
	}
	return id[len(id)-6:]
}

func MakeBoardSlug(boardName string, boardID string) string {
	return fmt.Sprintf("%s-%s",
		normalizeSlugPart(boardName, "board"),
		normalizeSlugPart(boardID, "run"),
	)
}

func MakeMonsterSlug(kind MonsterKind, name string, id EntityID) string {
	return fmt.Sprintf("%s-%s-%s",
		normalizeSlugPart(string(kind), "monster"),
		normalizeSlugPart(name, "unit"),
		shortSlugID(string(id)),
	)
}
