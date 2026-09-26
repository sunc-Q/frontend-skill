// Package maze generates perfect (spanning-tree) mazes and solves them.
package maze

import (
	"errors"
	"fmt"
	"strings"
)

const (
	Wall = '#'
	Path = ' '
	Mark = '*'
)

// ErrBadSize is returned for dimensions outside the supported range.
var ErrBadSize = errors.New("maze: bad size")

// Rand is the randomness dependency of Generate; injecting it keeps the
// generator deterministic and mockable.
type Rand interface {
	Intn(n int) int
}

// LCG is a small deterministic pseudo-random source (no stdlib rand, so
// generated mazes are reproducible across Go versions and platforms).
type LCG struct{ state uint32 }

func NewLCG(seed uint32) *LCG { return &LCG{state: seed | 1} }

func (l *LCG) Intn(n int) int {
	if n <= 0 {
		return 0
	}
	l.state = l.state*1664525 + 1013904223
	return int(l.state>>16) % n
}

// Maze is a grid of (2H+1) rows by (2W+1) columns holding W*H cells.
type Maze struct {
	W, H   int
	Grid   []byte
	carved []bool
}

func (m *Maze) Cols() int            { return 2*m.W + 1 }
func (m *Maze) Rows() int            { return 2*m.H + 1 }
func (m *Maze) at(r, c int) byte     { return m.Grid[r*m.Cols()+c] }
func (m *Maze) set(r, c int, v byte) { m.Grid[r*m.Cols()+c] = v }

// cellRC maps a cell index to its grid row/col.
func (m *Maze) cellRC(i int) (int, int) { return 2*(i/m.W) + 1, 2*(i%m.W) + 1 }

var dirs = [4][2]int{{-2, 0}, {2, 0}, {0, -2}, {0, 2}}

// Generate carves a perfect maze with an iterative randomized depth-first walk.
func Generate(w, h int, r Rand) (*Maze, error) {
	if w < 2 || h < 2 || w > 200 || h > 200 {
		return nil, fmt.Errorf("%w: %dx%d (want 2..200)", ErrBadSize, w, h)
	}
	if r == nil {
		return nil, errors.New("maze: nil Rand")
	}
	m := &Maze{W: w, H: h, Grid: make([]byte, m_size(w, h)), carved: make([]bool, w*h)}
	for i := range m.Grid {
		m.Grid[i] = Wall
	}
	stack := []int{0}
	m.carved[0] = true
	m.open(0)
	for len(stack) > 0 {
		cur := stack[len(stack)-1]
		cr, cc := m.cellRC(cur)
		var cand []int
		for _, d := range dirs {
			nr, nc := cr+d[0], cc+d[1]
			if nr < 1 || nr >= m.Rows()-1 || nc < 1 || nc >= m.Cols()-1 {
				continue
			}
			if ni := (nr/2)*w + nc/2; !m.carved[ni] {
				cand = append(cand, ni)
			}
		}
		if len(cand) == 0 {
			stack = stack[:len(stack)-1]
			continue
		}
		next := cand[r.Intn(len(cand))]
		nr, nc := m.cellRC(next)
		m.set((cr+nr)/2, (cc+nc)/2, Path)
		m.carved[next] = true
		m.open(next)
		stack = append(stack, next)
	}
	return m, nil
}

func m_size(w, h int) int { return (2*h + 1) * (2*w + 1) }

func (m *Maze) open(i int) {
	r, c := m.cellRC(i)
	m.set(r, c, Path)
}

// Start returns the grid position of the entry cell, End of the exit cell.
func (m *Maze) Start() (int, int) { return 1, 1 }
func (m *Maze) End() (int, int)   { return 2*m.H - 1, 2*m.W - 1 }

// Solve runs BFS from the entry cell to the exit cell.
func (m *Maze) Solve() ([][2]int, error) {
	cols := m.Cols()
	sr, sc := m.Start()
	er, ec := m.End()
	startIdx, endIdx := sr*cols+sc, er*cols+ec
	prev := make(map[int]int)
	seen := map[int]bool{startIdx: true}
	queue := []int{startIdx}
	steps := [4][2]int{{-1, 0}, {1, 0}, {0, -1}, {0, 1}}
	for len(queue) > 0 {
		cur := queue[0]
		queue = queue[1:]
		if cur == endIdx {
			return trace(cols, prev, startIdx, endIdx), nil
		}
		cr, cc := cur/cols, cur%cols
		for _, d := range steps {
			nr, nc := cr+d[0], cc+d[1]
			if nr < 0 || nr >= m.Rows() || nc < 0 || nc >= cols {
				continue
			}
			ni := nr*cols + nc
			if m.at(nr, nc) != Path || seen[ni] {
				continue
			}
			seen[ni] = true
			prev[ni] = cur
			queue = append(queue, ni)
		}
	}
	return nil, errors.New("maze: no path")
}

func trace(cols int, prev map[int]int, start, end int) [][2]int {
	var out [][2]int
	for i := end; ; i = prev[i] {
		out = append(out, [2]int{i / cols, i % cols})
		if i == start {
			break
		}
	}
	for l, r := 0, len(out)-1; l < r; l, r = l+1, r-1 {
		out[l], out[r] = out[r], out[l]
	}
	return out
}

// Draw renders the maze, marking the solution path with '*' and the entry /
// exit cells with 'S' and 'E'.
func (m *Maze) Draw(path [][2]int) string {
	g := make([]byte, len(m.Grid))
	copy(g, m.Grid)
	for i, v := range g {
		if v == Path {
			g[i] = '.'
		}
	}
	for _, p := range path {
		if g[p[0]*m.Cols()+p[1]] != Wall {
			g[p[0]*m.Cols()+p[1]] = Mark
		}
	}
	sr, sc := m.Start()
	er, ec := m.End()
	if g[sr*m.Cols()+sc] != Wall {
		g[sr*m.Cols()+sc] = 'S'
	}
	if g[er*m.Cols()+ec] != Wall {
		g[er*m.Cols()+ec] = 'E'
	}
	var b strings.Builder
	for r := 0; r < m.Rows(); r++ {
		b.Write(g[r*m.Cols() : (r+1)*m.Cols()])
		b.WriteByte('\n')
	}
	return b.String()
}

// String renders the bare maze without a solution.
func (m *Maze) String() string { return m.Draw(nil) }
