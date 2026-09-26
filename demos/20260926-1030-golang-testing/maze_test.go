package maze

import (
	"errors"
	"flag"
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

// ---------- TestMain: global setup / teardown ----------

var update = flag.Bool("update", false, "rewrite golden files in testdata/")

func TestMain(m *testing.M) {
	if err := os.MkdirAll("testdata", 0o755); err != nil {
		fmt.Fprintln(os.Stderr, "setup: "+err.Error())
		os.Exit(1)
	}
	code := m.Run()
	os.Exit(code)
}

// ---------- interface-based mocking ----------

// mockRand is a scripted stand-in for LCG: it records every n it was asked
// about and answers with a fixed strategy, so carving is fully predictable.
type mockRand struct {
	strategy string
	gotN     []int
}

func newMock(strategy string) *mockRand { return &mockRand{strategy: strategy} }

func (mr *mockRand) Intn(n int) int {
	mr.gotN = append(mr.gotN, n)
	if n <= 0 {
		return 0
	}
	switch mr.strategy {
	case "first":
		return 0
	case "last":
		return n - 1
	default:
		panic("mockRand: unknown strategy " + mr.strategy)
	}
}

func (mr *mockRand) calls() int { return len(mr.gotN) }

// ---------- helpers (t.Helper) ----------

func mustGenerate(t *testing.T, w, h int, r Rand) *Maze {
	t.Helper()
	m, err := Generate(w, h, r)
	if err != nil {
		t.Fatalf("Generate(%d,%d) failed: %v", w, h, err)
	}
	return m
}

// golden compares text against testdata/<name>, writing it when -update is set.
func golden(t *testing.T, name, got string) {
	t.Helper()
	path := filepath.Join("testdata", name)
	if *update {
		if err := os.WriteFile(path, []byte(got), 0o644); err != nil {
			t.Fatalf("write golden: %v", err)
		}
		t.Logf("updated %s", path)
		return
	}
	want, err := os.ReadFile(path)
	if err != nil {
		t.Fatalf("read golden %s: %v (run: go test -update)", path, err)
	}
	if got != string(want) {
		t.Errorf("golden mismatch for %s:\n--- got ---\n%s--- want ---\n%s", name, got, want)
	}
}

// ---------- table-driven: valid sizes ----------

func TestGenerate_Sizes(t *testing.T) {
	t.Parallel()
	tests := []struct {
		name     string
		w, h     int
		wantRows int
		wantCols int
		wantOpen int // carved cells
	}{
		{"minimum 2x2", 2, 2, 5, 5, 4},
		{"wide 9x2", 9, 2, 5, 19, 18},
		{"tall 2x9", 2, 9, 19, 5, 18},
		{"square 9x7", 9, 7, 15, 19, 63},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			t.Parallel()
			m := mustGenerate(t, tt.w, tt.h, NewLCG(42))
			if m.Rows() != tt.wantRows || m.Cols() != tt.wantCols {
				t.Errorf("dims = %dx%d; want %dx%d", m.Rows(), m.Cols(), tt.wantRows, tt.wantCols)
			}
			if got := cellOpen(m); got != tt.wantOpen {
				t.Errorf("carved cells = %d; want %d", got, tt.wantOpen)
			}
			// floor squares = cells + doors = cells + (cells-1); two of them are
			// overpainted by the S/E markers.
			if n := strings.Count(m.String(), "."); n != 2*tt.wantOpen-3 {
				t.Errorf("floor squares = %d; want %d", n, 2*tt.wantOpen-3)
			}
			// border must stay solid
			for c := 0; c < m.Cols(); c++ {
				if m.at(0, c) != Wall || m.at(m.Rows()-1, c) != Wall {
					t.Fatalf("top/bottom border breached at col %d", c)
				}
			}
			for r := 0; r < m.Rows(); r++ {
				if m.at(r, 0) != Wall || m.at(r, m.Cols()-1) != Wall {
					t.Fatalf("left/right border breached at row %d", r)
				}
			}
			if chars := charSet(m.String()); strings.Join(sortedChars(chars), "") != "#.ES" {
				t.Errorf("bare rendered charset = %v; want # . E S (no solution marks)", chars)
			}
		})
	}
}

// cellOpen counts carved cells. The maze grid is (2H+1)x(2W+1): a cell is the
// grid square (2r+1, 2c+1); the squares between two adjacent cells are the
// doors, so counting Path bytes would over-count by the number of doors.
func cellOpen(m *Maze) int {
	n := 0
	for i, v := range m.carved {
		if v {
			_ = i
			n++
		}
	}
	return n
}

func sortedChars(v []string) []string {
	out := append([]string(nil), v...)
	for i := range out {
		for j := i + 1; j < len(out); j++ {
			if out[j] < out[i] {
				out[i], out[j] = out[j], out[i]
			}
		}
	}
	return out
}

func charSet(s string) []string {
	seen := map[string]bool{}
	for _, r := range s {
		if r == '\n' {
			continue
		}
		seen[string(r)] = true
	}
	out := make([]string, 0, len(seen))
	for k := range seen {
		out = append(out, k)
	}
	return out
}

// ---------- table-driven: error cases ----------

func TestGenerate_Errors(t *testing.T) {
	t.Parallel()
	tests := []struct {
		name      string
		w, h      int
		rand      Rand
		wantErr   bool
		errString string
	}{
		{"valid", 3, 3, NewLCG(1), false, ""},
		{"zero width", 0, 3, NewLCG(1), true, "bad size"},
		{"one cell tall", 3, 1, NewLCG(1), true, "want 2..200"},
		{"negative", -4, 4, NewLCG(1), true, "bad size"},
		{"width too large", 201, 2, NewLCG(1), true, "bad size"},
		{"height at boundary", 2, 200, NewLCG(1), false, ""},
		{"nil rand", 3, 3, nil, true, "nil Rand"},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			result, err := Generate(tt.w, tt.h, tt.rand)

			if tt.wantErr {
				if err == nil {
					t.Fatalf("expected error, got nil (maze %v)", result)
				}
				if !strings.Contains(err.Error(), tt.errString) {
					t.Errorf("error = %v; want containing %q", err, tt.errString)
				}
				if errors.Is(err, ErrBadSize) != (tt.errString == "bad size" || tt.errString == "want 2..200") {
					t.Errorf("errors.Is(ErrBadSize) mismatch for %v", err)
				}
				return
			}
			if err != nil {
				t.Fatalf("unexpected error: %v", err)
			}
			if result == nil {
				t.Fatal("got nil maze for valid input")
			}
		})
	}
}

// ---------- determinism + mock-driven golden files ----------

func TestGenerate_DeterministicLCG(t *testing.T) {
	t.Parallel()
	a := mustGenerate(t, 9, 7, NewLCG(42)).String()
	b := mustGenerate(t, 9, 7, NewLCG(42)).String()
	if a != b {
		t.Error("same seed produced two different mazes")
	}
	c := mustGenerate(t, 9, 7, NewLCG(7)).String()
	if a == c {
		t.Error("different seeds produced an identical maze (fixture too regular?)")
	}
	golden(t, "lcg42_9x7.golden.txt", a)
}

// With a scripted mock the carve order is fully determined by the dirs table,
// so the golden file doubles as documentation of the backtracker.
func TestGenerate_MockFirstChoosesFirstDirection(t *testing.T) {
	mr := newMock("first")
	m := mustGenerate(t, 5, 4, mr)
	if mr.calls() != 19 {
		t.Errorf("Intn calls = %d; want 19 (one per carve step)", mr.calls())
	}
	golden(t, "mockfirst_5x4.golden.txt", m.String())
	for _, n := range mr.gotN {
		if n < 1 || n > 4 {
			t.Fatalf("Intn called with out-of-range n=%d", n)
		}
	}
}

func TestGenerate_MockLastDiffersFromFirst(t *testing.T) {
	first := mustGenerate(t, 5, 4, newMock("first")).String()
	last := mustGenerate(t, 5, 4, newMock("last")).String()
	if first == last {
		t.Error("strategies first/last produced identical mazes")
	}
	golden(t, "mocklast_5x4.golden.txt", last)
}

// ---------- perfect-maze properties ----------

// TestMazeIsPerfect asserts the structural claim of the generator: the carved
// cells form a spanning tree, i.e. every cell is reachable and any two cells
// are joined by exactly one path.
func TestMazeIsPerfect(t *testing.T) {
	t.Parallel()
	tests := []struct {
		name string
		w, h int
		seed uint32
	}{
		{"small lcg", 4, 4, 42},
		{"rect lcg", 9, 7, 1},
		{"seed 7", 9, 7, 7},
		{"mock first", 6, 6, 0},
		{"wide", 12, 3, 99},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			t.Parallel()
			var r Rand = NewLCG(tt.seed)
			if tt.name == "mock first" {
				r = newMock("first")
			}
			m := mustGenerate(t, tt.w, tt.h, r)
			if got, want := cellOpen(m), tt.w*tt.h; got != want {
				t.Fatalf("open cells = %d; want %d", got, want)
			}
			// tree ⇒ edges = vertices - 1, and exactly one simple path end-to-end
			if paths := countSimplePaths(m); paths != 1 {
				t.Errorf("simple start→end paths = %d; want exactly 1", paths)
			}
			if !allCellsReachable(m) {
				t.Error("some carved cell is unreachable from the entry")
			}
		})
	}
}

func countSimplePaths(m *Maze) int {
	var n int
	er, ec := m.End()
	var walk func(r, c int, prev [2]int)
	walk = func(r, c int, prev [2]int) {
		if n > 4 {
			return
		}
		if r == er && c == ec {
			n++
			return
		}
		for _, d := range [4][2]int{{-1, 0}, {1, 0}, {0, -1}, {0, 1}} {
			nr, nc := r+d[0], c+d[1]
			if nr < 0 || nr >= m.Rows() || nc < 0 || nc >= m.Cols() {
				continue
			}
			if m.at(nr, nc) == Wall || (nr == prev[0] && nc == prev[1]) {
				continue
			}
			walk(nr, nc, [2]int{r, c})
		}
	}
	walk(1, 1, [2]int{-1, -1})
	return n
}

func allCellsReachable(m *Maze) bool {

	seen := map[[2]int]bool{{1, 1}: true}
	queue := [][2]int{{1, 1}}
	for len(queue) > 0 {
		cur := queue[0]
		queue = queue[1:]
		for _, d := range [4][2]int{{-1, 0}, {1, 0}, {0, -1}, {0, 1}} {
			nr, nc := cur[0]+d[0], cur[1]+d[1]
			if nr < 0 || nr >= m.Rows() || nc < 0 || nc >= m.Cols() {
				continue
			}
			if m.at(nr, nc) == Wall || seen[[2]int{nr, nc}] {
				continue
			}
			seen[[2]int{nr, nc}] = true
			queue = append(queue, [2]int{nr, nc})
		}
	}
	// every floor square (cell or door) must be reachable, none may be missed
	return len(seen) == floorSquares(m)
}

func floorSquares(m *Maze) int {
	n := 0
	for _, v := range m.Grid {
		if v == Path {
			n++
		}
	}
	return n
}

// ---------- Solve ----------

func TestSolve_PathIsContiguous(t *testing.T) {
	t.Parallel()
	tests := []struct {
		name    string
		w, h    int
		wantLen int // >= lower bound on path length
	}{
		{"2x2", 2, 2, 3},
		{"5x4 seed 42", 5, 4, 9},
		{"9x7 seed 42", 9, 7, 15},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			t.Parallel()
			m := mustGenerate(t, tt.w, tt.h, NewLCG(42))
			path, err := m.Solve()
			if err != nil {
				t.Fatalf("Solve: %v", err)
			}
			if len(path) < tt.wantLen {
				t.Errorf("path len = %d; want >= %d", len(path), tt.wantLen)
			}
			sr, sc := m.Start()
			er, ec := m.End()
			if path[0] != [2]int{sr, sc} || path[len(path)-1] != [2]int{er, ec} {
				t.Errorf("path endpoints = %v..%v; want S(%d,%d)..E(%d,%d)", path[0], path[len(path)-1], sr, sc, er, ec)
			}
			for i := 1; i < len(path); i++ {
				dr, dc := abs(path[i][0]-path[i-1][0]), abs(path[i][1]-path[i-1][1])
				if dr+dc != 1 {
					t.Fatalf("step %d jumps %v -> %v", i, path[i-1], path[i])
				}
			}
			// BFS returns a shortest path: length must equal Manhattan+2*detours,
			// and must be the unique simple path in a perfect maze.
			if uniq := singlePathLen(m); uniq != len(path) {
				t.Errorf("Solve len = %d; unique-path len = %d", len(path), uniq)
			}
		})
	}
}

func singlePathLen(m *Maze) int {
	er, ec := m.End()
	best := -1
	var walk func(r, c, n int, prev [2]int)
	walk = func(r, c, n int, prev [2]int) {
		if r == er && c == ec {
			if best < 0 || n < best {
				best = n
			}
			return
		}
		for _, d := range [4][2]int{{-1, 0}, {1, 0}, {0, -1}, {0, 1}} {
			nr, nc := r+d[0], c+d[1]
			if nr < 0 || nr >= m.Rows() || nc < 0 || nc >= m.Cols() {
				continue
			}
			if m.at(nr, nc) == Wall || (nr == prev[0] && nc == prev[1]) {
				continue
			}
			walk(nr, nc, n+1, [2]int{r, c})
		}
	}
	walk(1, 1, 1, [2]int{-1, -1})
	return best
}

func abs(v int) int {
	if v < 0 {
		return -v
	}
	return v
}

func TestSolve_NoPath(t *testing.T) {
	// Hand-built 2x2 maze with the entry cell sealed off.
	m := &Maze{W: 2, H: 2, Grid: []byte(strings.Join([]string{
		"#####",
		"# ###",
		"## ##",
		"#   #",
		"#####",
	}, "")), carved: []bool{false, true, true, true}}
	if _, err := m.Solve(); err == nil {
		t.Fatal("Solve on sealed maze = nil error; want 'no path'")
	} else if !strings.Contains(err.Error(), "no path") {
		t.Errorf("error = %v; want containing %q", err, "no path")
	}
}

func TestDraw_MarksPath(t *testing.T) {
	m := mustGenerate(t, 3, 3, NewLCG(42))
	path, err := m.Solve()
	if err != nil {
		t.Fatalf("Solve: %v", err)
	}
	drawn := m.Draw(path)
	if !strings.Contains(drawn, string(Mark)) {
		t.Error("drawn maze has no solution marks")
	}
	if strings.Count(drawn, "S") != 1 || strings.Count(drawn, "E") != 1 {
		t.Error("drawn maze must contain exactly one S and one E")
	}
	if got := strings.Count(drawn, "\n"); got != m.Rows() {
		t.Errorf("drawn rows = %d; want %d", got, m.Rows())
	}
	// Draw must not mutate the underlying grid.
	if m.String() == drawn {
		t.Error("Draw did not mark anything, or it mutated the grid")
	}
	if count := strings.Count(m.String(), "."); count != 15 {
		t.Errorf("bare maze floor squares = %d; want 15 (Draw leaked into the grid)", count)
	}
}

// ---------- benchmarks ----------

func BenchmarkGenerate(b *testing.B) {
	for _, size := range []int{8, 32, 128} {
		b.Run(fmt.Sprintf("size-%d", size), func(b *testing.B) {
			b.ReportAllocs()
			for i := 0; i < b.N; i++ {
				if _, err := Generate(size, size, NewLCG(uint32(i)+1)); err != nil {
					b.Fatal(err)
				}
			}
		})
	}
}

func BenchmarkSolveParallel(b *testing.B) {
	m := mustGenerate(&testing.T{}, 64, 64, NewLCG(42))
	b.ReportAllocs()
	b.RunParallel(func(pb *testing.PB) {
		for pb.Next() {
			if _, err := m.Solve(); err != nil {
				b.Fatal(err)
			}
		}
	})
}
