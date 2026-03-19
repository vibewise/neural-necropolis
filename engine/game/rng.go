package game

import "math"

// Rng is a seedable PRNG based on mulberry32, matching the TypeScript implementation.
type Rng struct {
	state uint32
}

func NewRng(seed string) *Rng {
	var s int32
	for i := 0; i < len(seed); i++ {
		s = ((s << 5) - s + int32(seed[i]))
	}
	if s == 0 {
		s = 1
	}
	return &Rng{state: uint32(s)}
}

func (r *Rng) Next() float64 {
	r.state += 0x6D2B79F5
	t := r.state
	t = imul(t^(t>>15), t|1)
	t ^= t + imul(t^(t>>7), t|61)
	return float64(t^(t>>14)) / 4294967296.0
}

func (r *Rng) Int(min, max int) int {
	return min + int(math.Floor(r.Next()*float64(max-min+1)))
}

func (r *Rng) Pick(arr []string) string {
	return arr[int(math.Floor(r.Next()*float64(len(arr))))]
}

func (r *Rng) PickItemKind(arr []ItemKind) ItemKind {
	return arr[int(math.Floor(r.Next()*float64(len(arr))))]
}

func (r *Rng) PickMonsterKind(arr []MonsterKind) MonsterKind {
	return arr[int(math.Floor(r.Next()*float64(len(arr))))]
}

func (r *Rng) Shuffle(arr []string) []string {
	a := make([]string, len(arr))
	copy(a, arr)
	for i := len(a) - 1; i > 0; i-- {
		j := int(math.Floor(r.Next() * float64(i+1)))
		a[i], a[j] = a[j], a[i]
	}
	return a
}

func (r *Rng) ShuffleDirections(arr []Direction) []Direction {
	a := make([]Direction, len(arr))
	copy(a, arr)
	for i := len(a) - 1; i > 0; i-- {
		j := int(math.Floor(r.Next() * float64(i+1)))
		a[i], a[j] = a[j], a[i]
	}
	return a
}

func (r *Rng) Chance(p float64) bool {
	return r.Next() < p
}

// imul emulates Math.imul from JavaScript (32-bit integer multiply).
func imul(a, b uint32) uint32 {
	return uint32(int32(a) * int32(b))
}
