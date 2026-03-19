package server

import (
	_ "embed"
)

// DashboardHTML is the full HTML dashboard loaded at build time.
// It reads from dashboard.html in this directory.
//
//go:embed dashboard.html
var DashboardHTML string
