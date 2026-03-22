package server

import (
	"embed"
	"io/fs"
)

// DashboardHTML is the legacy monolithic HTML dashboard kept as a temporary
// fallback while the embedded React app replaces it as the default UI.
//
//go:embed dashboard.html
var DashboardHTML string

//go:embed dashboard_app/index.html dashboard_app/assets/*
var dashboardAppBundle embed.FS

var DashboardAppFS fs.FS = func() fs.FS {
	sub, err := fs.Sub(dashboardAppBundle, "dashboard_app")
	if err != nil {
		panic(err)
	}
	return sub
}()
