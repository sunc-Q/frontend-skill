// Command maze renders a generated maze (and its solution) to stdout or a file.
package main

import (
	"flag"
	"fmt"
	"os"

	"skilllab.dev/mazedemo"
)

func main() {
	w := flag.Int("w", 12, "cells wide (2..200)")
	h := flag.Int("h", 8, "cells high (2..200)")
	seed := flag.Uint("seed", 2026, "deterministic seed")
	solve := flag.Bool("solve", true, "mark the solution path")
	out := flag.String("out", "", "write to this file instead of stdout")
	flag.Parse()

	m, err := maze.Generate(*w, *h, maze.NewLCG(uint32(*seed)))
	if err != nil {
		fmt.Fprintln(os.Stderr, "error:", err)
		os.Exit(1)
	}
	var text string
	if *solve {
		path, err := m.Solve()
		if err != nil {
			fmt.Fprintln(os.Stderr, "error:", err)
			os.Exit(1)
		}
		text = fmt.Sprintf("%dx%d cells / %dx%d grid / seed %d / solution %d steps\n%s",
			m.W, m.H, m.Rows(), m.Cols(), *seed, len(path), m.Draw(path))
	} else {
		text = m.String()
	}
	if *out == "" {
		fmt.Print(text)
		return
	}
	if err := os.WriteFile(*out, []byte(text), 0o644); err != nil {
		fmt.Fprintln(os.Stderr, "error:", err)
		os.Exit(1)
	}
	fmt.Println("wrote", *out)
}
