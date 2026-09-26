#!/bin/sh
# Negative controls: mutate a copy of the source, rebuild, re-run the same 18 assertions.
# Expect exactly one FAIL per mutant, and the SAME mutant must not break any other assertion.
set -e
LAB=$(cd ../.. && pwd)   # skill演示场 root — must be absolute, go rejects a relative GOMODCACHE
SRC=$PWD/src
MUT=$LAB/.tmp/mut-r17
export PATH=$HOME/.local/go/1.27.1/bin:$PATH
export GOMODCACHE=$LAB/.tmp/gomod-gin GOCACHE=$LAB/.tmp/gocache-gin GOPROXY=off

rm -rf "$MUT"; mkdir -p "$MUT"
cp -R "$SRC" "$MUT/m1"; cp -R "$SRC" "$MUT/m2"

# M1 (structural): drop SecurityHeaders from the middleware chain -> A14 must go red
perl -0pi -e 's/\tr\.Use\(middleware\.SecurityHeaders\(\)\)\n//' "$MUT/m1/cmd/api/main.go"
# M2 (value): loosen the query binding ceiling max=100 -> max=1000 -> A6 must go red
perl -0pi -e 's/binding:"omitempty,min=1,max=100"/binding:"omitempty,min=1,max=1000"/' "$MUT/m2/internal/domain/user.go"

for m in m1 m2; do (cd "$MUT/$m" && go build -o "$MUT/api-$m" ./cmd/api); done

echo "=== M1: SecurityHeaders removed ==="
BIN=$MUT/api-m1 PORT=8791 ./run-transcript.sh | grep -E '^(PASS|FAIL|SUMMARY)' | grep -E 'A14|SUMMARY' || true
echo "=== M2: ListQuery max=100 -> 1000 ==="
BIN=$MUT/api-m2 PORT=8792 ./run-transcript.sh | grep -E '^(PASS|FAIL|SUMMARY)' | grep -E 'A6|SUMMARY' || true
echo "=== baseline restored ==="
BIN=$LAB/.tmp/api-r17 PORT=8793 ./run-transcript.sh | grep -E '^(FAIL|SUMMARY)' || true
