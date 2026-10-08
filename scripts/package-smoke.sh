#!/usr/bin/env bash
# Launch an installed or portable build and wait for its companion to answer.
# Usage: package-smoke.sh <command...>   (run under xvfb-run)
set -uo pipefail
export CALICO_USER_DATA
CALICO_USER_DATA=$(mktemp -d)
"$@" >"$CALICO_USER_DATA/run.log" 2>&1 &
pid=$!
for _ in $(seq 1 30); do
  if curl -fs http://127.0.0.1:8787/api/status >/dev/null; then
    echo "ok: $* answered /api/status"
    kill "$pid" 2>/dev/null
    exit 0
  fi
  kill -0 "$pid" 2>/dev/null || break
  sleep 1
done
echo "fail: $* did not answer. Log:"
cat "$CALICO_USER_DATA/run.log"
kill "$pid" 2>/dev/null
exit 1
