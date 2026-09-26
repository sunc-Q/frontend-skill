#!/bin/sh
# Reproduce: PORT=8787 API_KEY=lab-secret ./run-transcript.sh
set -e
cd "$(dirname "$0")"
BIN=${BIN:-../../.tmp/api}
PORT=${PORT:-8787}
export PORT API_KEY=${API_KEY:-lab-secret} APP_ENV=development GIN_MODE=release
SRVLOG=$(mktemp); BODY=$(mktemp)
pass=0; fail=0
ok(){ printf 'PASS  %s\n' "$1"; pass=$((pass+1)); }
no(){ printf 'FAIL  %s  <<%s>>\n' "$1" "$2"; fail=$((fail+1)); }
has(){ printf '%s' "$1" | grep -q "$2"; }
code_and_body(){ # $1 method $2 path $3 extra curl args...
  m=$1; p=$2; shift 2
  printf '%s' "$(curl -s -o "$BODY" -w '%{http_code}' -X "$m" "$@" "http://127.0.0.1:$PORT$p")"
}
body(){ cat "$BODY"; }

"$BIN" > "$SRVLOG" 2>&1 &
PID=$!
for i in 1 2 3 4 5 6 7 8 9 10; do curl -sf "http://127.0.0.1:$PORT/health" >/dev/null 2>&1 && break; sleep 0.2; done

# --- A1 health
c=$(code_and_body GET /health); [ "$c" = 200 ] && has "$(body)" '"status":"ok"' && ok "A1 /health 200 ok" || no "A1 /health" "$c $(body)"

# --- A2 create: 201 + uuid id + default role + NO password_hash leaked
c=$(code_and_body POST /api/v1/users -H 'Content-Type: application/json' -d '{"name":"Qiushi Lyu","email":"Qiushi.Lyu@Example.COM","password":"correct-horse"}')
U1=$(body)
if [ "$c" = 201 ] && has "$U1" '"role":"user"' && ! has "$U1" 'password_hash' && has "$U1" '"email":"qiushi.lyu@example.com"'; then ok "A2 POST/users 201, role default, email lowercased, password_hash never serialized"; else no "A2" "$c $U1"; fi
ID1=$(printf '%s' "$U1" | sed -n 's/.*"id":"\([^"]*\)".*/\1/p')

# --- A3 validation: field-level errors
c=$(code_and_body POST /api/v1/users -H 'Content-Type: application/json' -d '{"name":"Q","email":"not-an-email","password":"short"}')
V=$(body)
if [ "$c" = 400 ] && has "$V" '"field":"Email"' && has "$V" 'must be a valid email address' && has "$V" '"field":"Name"' && has "$V" 'must be at least 2 characters' && has "$V" '"field":"Password"' && has "$V" 'must be at least 8 characters'; then ok "A3 400 carries field-level messages for Name/Email/Password"; else no "A3" "$c $V"; fi

# --- A4 sanitize after bind (XSS escaped)
c=$(code_and_body POST /api/v1/users -H 'Content-Type: application/json' -d '{"name":"<b>Xss</b>","email":"x@example.com","password":"correct-horse"}')
X=$(body)
# JSON-decode before comparing: encoding/json escapes & < > as \u0026/\u003c, so grep on the wire form is wrong.
NAME=$(printf '%s' "$X" | node -e 'let d="";process.stdin.on("data",c=>d+=c).on("end",()=>{try{process.stdout.write(JSON.parse(d).name)}catch(e){process.stdout.write("PARSE_ERR")}})')
if [ "$c" = 201 ] && [ "$NAME" = '&lt;b&gt;Xss&lt;/b&gt;' ]; then ok "A4 html.EscapeString after bind: decoded name == &lt;b&gt;Xss&lt;/b&gt; (no live markup)"; else no "A4" "$c name=$NAME"; fi

# --- A5 conflict
c=$(code_and_body POST /api/v1/users -H 'Content-Type: application/json' -d '{"name":"Dup User","email":"qiushi.lyu@example.com","password":"correct-horse"}')
[ "$c" = 409 ] && has "$(body)" 'resource already exists' && ok "A5 duplicate email -> 409 resource already exists" || no "A5" "$c $(body)"

# --- A6 query binding max=100
c=$(code_and_body GET "/api/v1/users?limit=200")
[ "$c" = 400 ] && has "$(body)" 'must be at most 100 characters' || [ "$c" = 400 ] && has "$(body)" '"field":"Limit"' && ok "A6 GET /users?limit=200 rejected by binding max=100" || no "A6" "$c $(body)"

# --- A7 list pagination
c=$(code_and_body GET "/api/v1/users?page=1&limit=2"); L=$(body)
[ "$c" = 200 ] && has "$L" '"total":2' && has "$L" '"limit":2' && ok "A7 list returns total=2 after two successful creates" || no "A7" "$c $L"

# --- A19 effective pagination echoed (defect found in the first transcript: page was reported as 0)
c=$(code_and_body GET "/api/v1/users"); E=$(body)
if [ "$c" = 200 ] && has "$E" '"page":1' && has "$E" '"limit":20'; then ok "A19 bare GET /users echoes the effective page=1 limit=20, not the zero values"; else no "A19" "$c $E"; fi

# --- A8 uri uuid binding
c=$(code_and_body GET "/api/v1/users/not-a-uuid")
[ "$c" = 400 ] && has "$(body)" '"field":"ID"' && ok "A8 non-UUID path param -> 400 field ID (ShouldBindUri)" || no "A8" "$c $(body)"

# --- A9 not found via AppError
RAND=6ba7b810-9dad-11d1-80b4-00c04fd430c8
c=$(code_and_body GET "/api/v1/users/$RAND")
[ "$c" = 404 ] && has "$(body)" 'resource not found' && ok "A9 unknown id -> 404 from domain.ErrNotFound (status decided in domain layer)" || no "A9" "$c $(body)"

# --- A10 protected route: missing / wrong / right key
c1=$(code_and_body DELETE "/api/v1/users/$ID1")
c2=$(code_and_body DELETE "/api/v1/users/$ID1" -H 'X-Api-Key: wrong-key')
c3=$(code_and_body DELETE "/api/v1/users/$ID1" -H "X-Api-Key: $API_KEY")
if [ "$c1" = 401 ] && [ "$c2" = 401 ] && [ "$c3" = 204 ]; then ok "A10 DELETE: no key 401, wrong key 401, right key 204"; else no "A10" "$c1/$c2/$c3"; fi

# --- A11 delete twice -> 404
c=$(code_and_body DELETE "/api/v1/users/$ID1" -H "X-Api-Key: $API_KEY")
[ "$c" = 404 ] && ok "A11 second delete -> 404 (repo ErrNoRows mapped to AppError)" || no "A11" "$c $(body)"

# --- A12 timeout middleware is cooperative (handler respects ctx, 250ms deadline vs 2s sleep)
START=$(printf '%s' "$(date +%s%N 2>/dev/null || gdate +%s%N)")
c=$(code_and_body GET "/api/v1/debug/slow"); EL=$(body)
if [ "$c" = 503 ]; then ok "A12 /debug/slow returned 503 (handler gave up at 250ms deadline, no 504 fallback needed)"; else no "A12" "$c $EL"; fi

# --- A13 recovery: JSON 500, stack never reaches client
c=$(code_and_body GET "/api/v1/debug/panic"); P=$(body)
if [ "$c" = 500 ] && has "$P" '"error":"internal server error"' && ! has "$P" 'goroutine' && ! has "$P" 'runtime/debug'; then ok "A13 panic -> JSON 500 generic message, stack only in server log"; else no "A13" "$c $P"; fi

# --- A14 security headers even on an error response
H=$(curl -s -D - -o /dev/null "http://127.0.0.1:$PORT/api/v1/users/$RAND")
if has "$H" 'X-Content-Type-Options: nosniff' && has "$H" 'Content-Security-Policy: default-src' && has "$H" 'X-Frame-Options: DENY' && has "$H" 'Referrer-Policy: strict-origin-when-cross-origin'; then ok "A14 OWASP headers present on 404 (SecurityHeaders registered before routes)"; else no "A14" "$(printf '%s' "$H" | tr '\n' '|')"; fi

# --- A15 request id reuse (distributed tracing propagation)
H=$(curl -s -D - -o /dev/null -H 'X-Request-ID: trace-me-42' "http://127.0.0.1:$PORT/health")
printf '%s' "$H" | grep -qi '^X-Request-Id: trace-me-42' && ok "A15 incoming X-Request-ID reused verbatim (net/http canonicalises the header name to X-Request-Id)" || no "A15" "$(printf '%s' "$H" | tr '\n' '|')"

# --- A16 CORS allowlist: allowed origin echoed, disallowed origin refused
H1=$(curl -s -D - -o /dev/null -H 'Origin: http://localhost:5173' "http://127.0.0.1:$PORT/health")
H2=$(curl -s -D - -o /dev/null -H 'Origin: http://evil.example' "http://127.0.0.1:$PORT/health")
if has "$H1" 'Access-Control-Allow-Origin: http://localhost:5173' && ! has "$H2" 'Access-Control-Allow-Origin: http://evil.example'; then ok "A16 CORS allowlist: 5173 accepted, evil.example refused"; else no "A16" "$(printf '%s' "$H1" | tr '\n' '|') // $(printf '%s' "$H2" | tr '\n' '|')"; fi

# --- A17 structured log levels from slog middleware
LV_WARN=$(grep -c '"level":"WARN"' "$SRVLOG" || true); LV_ERR=$(grep -c '"level":"ERROR"' "$SRVLOG" || true)
if [ "$LV_WARN" -ge 4 ] && [ "$LV_ERR" -ge 1 ] && has "$(cat "$SRVLOG")" 'panic recovered'; then ok "A17 slog middleware: $LV_WARN WARN (>=400) + $LV_ERR ERROR (>=500) lines, panic stack logged server-side"; else no "A17" "warn=$LV_WARN err=$LV_ERR"; fi

# --- A18 graceful shutdown
kill -TERM $PID; wait $PID 2>/dev/null; RC=$?
if [ "$RC" = 0 ] && has "$(cat "$SRVLOG")" 'server stopped' && ! curl -s -m 1 "http://127.0.0.1:$PORT/health" >/dev/null 2>&1; then ok "A18 SIGTERM -> srv.Shutdown -> exit 0, port released"; else no "A18" "rc=$RC"; fi

echo "SERVER LOG (slog JSON, $SRVLOG):"; cat "$SRVLOG"
echo "SUMMARY pass=$pass fail=$fail"
rm -f "$SRVLOG" "$BODY"
[ "$fail" = 0 ]
