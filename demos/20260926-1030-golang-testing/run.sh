#!/bin/sh
# Reproduce this round from scratch. All Go caches stay inside LAB/.tmp.
set -e
LAB=$(cd ../.. && pwd)   # LAB/skill演示场 root (demos/<run>/ -> ../..)
export GOCACHE="$LAB/.tmp/gocache" GOPATH="$LAB/.tmp/gopath" GOFLAGS=-mod=mod
LOG=output.log
: > $LOG

say() { printf '\n===== %s =====\n' "$*" | tee -a $LOG; }

say "go version / env (no network, stdlib only)"
{ go version; go env GOVERSION GOCACHE GOPATH GOPROXY; } >> $LOG 2>&1
tail -6 $LOG

say "1. build the CLI into LAB/.tmp (binary is NOT left in demos)"
go build -o "$LAB/.tmp/maze" ./cmd/maze
echo "built $LAB/.tmp/maze" | tee -a $LOG

say "2. visible artifact: maze-solved.txt (24x12 cells, seed 20260926)"
"$LAB/.tmp/maze" -w 24 -h 12 -seed 20260926 -out maze-solved.txt | tee -a $LOG
"$LAB/.tmp/maze" -w 24 -h 12 -seed 20260926 -solve=false -out maze-plain.txt | tee -a $LOG
cat maze-solved.txt | tee -a $LOG

say "3. CLI boundary behaviour (real error, exit code must be 1)"
set +e
"$LAB/.tmp/maze" -w 1 -h 5 ; echo "exit=$?"
set -e
"$LAB/.tmp/maze" -w 1 -h 5 >> $LOG 2>&1 || echo "exit=$? (expected non-zero)" | tee -a $LOG

say "4. go test -v -coverprofile (unit + golden + mock + property)"
go test -v -count=1 -covermode=set -coverprofile=coverage.out ./... 2>&1 | tee -a $LOG

say "5. integration tests (build tag) + -short skip behaviour"
go test -tags=integration -run Integration -v -count=1 ./... 2>&1 | tee -a $LOG
go test -short -tags=integration -run Integration -v -count=1 ./... 2>&1 | grep -E 'SKIP|ok|PASS' | tee -a $LOG

say "6. coverage per function + coverage.html (open this in a browser)"
go tool cover -func=coverage.out 2>&1 | tee -a $LOG
go tool cover -html=coverage.out -o coverage.html
ls -l coverage.html | tee -a $LOG

say "7. benchmarks (sub-benchmarks over sizes + RunParallel)"
go test -run '^NoTestsHere$' -bench . -benchtime=200x -count=1 . 2>&1 | tee -a $LOG

say "8a. NEGATIVE CONTROL A: value mutation (LCG multiplier +1) -> only golden tests must fail"
cp maze.go .maze.go.bak
sed 's/1664525/1664526/' maze.go > .maze.go.tmp && mv .maze.go.tmp maze.go
set +e
go test -run 'Deterministic|MockFirst|IsPerfect|Solve' -count=1 . 2>&1 | tee -a $LOG | tail -12
set -e
mv .maze.go.bak maze.go

say "8b. NEGATIVE CONTROL B: structural mutation (stop carving doors) -> property tests must fail"
cp maze.go .maze.go.bak
sed -e 's#^\(\t*\)m.set((cr+nr)/2, (cc+nc)/2, Path)#\1_, _ = nr, nc#' maze.go > .maze.go.tmp && mv .maze.go.tmp maze.go
grep -c '_, _ = nr, nc' maze.go
set +e
go test -run 'IsPerfect|Solve|Sizes' -count=1 . 2>&1 | grep -E '^(---|ok|FAIL|    maze_test)' | tee -a $LOG | tail -20
set -e
mv .maze.go.bak maze.go

say "9. restore check: suite must be green again"
go test -count=1 . 2>&1 | tee -a $LOG
gofmt -l . | tee -a $LOG
echo "gofmt -l reported nothing above if the package is formatted" | tee -a $LOG
printf '\n===== SUMMARY =====\nPASS=%s FAIL=%s  (section 8a/8b FAILs are the two deliberate negative controls)\n' "$(grep -c -- '--- PASS' $LOG)" "$(grep -c -- '--- FAIL' $LOG)" | tee -a $LOG
go vet ./... && echo "go vet: clean" | tee -a $LOG
go vet -tags=integration ./... && echo "go vet -tags=integration: clean" | tee -a $LOG
