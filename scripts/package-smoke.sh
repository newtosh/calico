#!/usr/bin/env bash
# Launch an installed or portable build and wait for its companion to answer.
# Usage: package-smoke.sh <command...>   (run under xvfb-run)
set -uo pipefail
up() { curl -fs -m 2 http://127.0.0.1:8787/api/status >/dev/null; }
if up; then
  echo "fail: port 8787 is already answering, so this run would prove nothing"
  exit 1
fi
export CALICO_USER_DATA
CALICO_USER_DATA=$(mktemp -d)
# Own process group, so Electron's helpers die with it.
setsid "$@" >"$CALICO_USER_DATA/run.log" 2>&1 &
pid=$!
stop() {
  kill -- -"$pid" 2>/dev/null
  for _ in $(seq 1 20); do up || return 0; sleep 0.5; done
  kill -9 -- -"$pid" 2>/dev/null
}
for _ in $(seq 1 30); do
  if up; then
    echo "ok: $* answered /api/status"
    stop
    exit 0
  fi
  kill -0 "$pid" 2>/dev/null || break
  sleep 1
done
echo "fail: $* did not answer. Log:"
cat "$CALICO_USER_DATA/run.log"
stop
exit 1
