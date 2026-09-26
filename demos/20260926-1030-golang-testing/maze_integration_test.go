//go:build integration

// Integration-style test: it writes real files under a temp dir and re-reads
// them, mirroring what the cmd/maze binary does. Run with:
//
//	go test -tags=integration ./...
//	go test -short -tags=integration ./...   # skips
package maze

import (
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func TestIntegration_WriteAndReloadMaze(t *testing.T) {
	if testing.Short() {
		t.Skip("skipping integration test in short mode")
	}
	dir := t.TempDir()
	m := mustGenerate(t, 12, 8, NewLCG(2026))
	path, err := m.Solve()
	if err != nil {
		t.Fatalf("Solve: %v", err)
	}
	out := filepath.Join(dir, "maze.txt")
	if err := os.WriteFile(out, []byte(m.Draw(path)), 0o644); err != nil {
		t.Fatalf("WriteFile: %v", err)
	}
	raw, err := os.ReadFile(out)
	if err != nil {
		t.Fatalf("ReadFile: %v", err)
	}
	got := string(raw)
	if !strings.HasPrefix(got, "#####") || !strings.Contains(got, "E") {
		t.Errorf("reloaded maze looks wrong:\n%s", got)
	}
	if lines := strings.Count(got, "\n"); lines != m.Rows() {
		t.Errorf("reloaded lines = %d; want %d", lines, m.Rows())
	}
	// the round-trip must be byte-identical to a fresh render
	if got != m.Draw(path) {
		t.Error("round-trip differs from in-memory render")
	}
	if fi, _ := os.Stat(out); fi.Size() < 100 {
		t.Errorf("file too small: %d bytes", fi.Size())
	}
}
