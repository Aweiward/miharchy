#!/usr/bin/env bash
# Scratch Suwayomi-Server for verification.
#   server.sh start    start it, write $RUN/server.json, wait until GraphQL answers
#   server.sh doctor   read-only: is our instance up, on our port, answering with our credentials?
#   server.sh stop     stop the instance this run started (by PID file), keep $RUN/evidence
set -euo pipefail
source "$(dirname "$0")/env.sh"

gql() { curl -s -m 30 -u "$(jq -r .username "$SERVER_JSON"):$(jq -r .password "$SERVER_JSON")" -H 'content-type: application/json' -X POST -d "$1" "http://127.0.0.1:$PORT/api/graphql"; }

case "${1:-}" in
start)
  # Another run's live server in this dir would be killed by our stop; refuse to share it.
  if [ -f "$RUN/server.pid" ] && kill -0 "$(cat "$RUN/server.pid")" 2>/dev/null; then
    echo "$RUN already has a running server (pid $(cat "$RUN/server.pid")); set your own MIHARCHY_VERIFY_DIR" >&2; exit 1
  fi
  ss -ltn | grep -q ":$PORT " && { echo "port $PORT is taken; pick another MIHARCHY_VERIFY_PORT" >&2; exit 1; }
  install -d -m 700 "$RUN" "$SERVER_DIR" "$SERVER_DIR/tmp" "$EVIDENCE"
  pw=$(openssl rand -hex 16)
  printf 'server.ip = "127.0.0.1"\nserver.port = %s\nserver.webUIEnabled = false\nserver.systemTrayEnabled = false\nserver.authMode = "basic_auth"\nserver.authUsername = "verify"\nserver.authPassword = "%s"\n' "$PORT" "$pw" > "$SERVER_DIR/server.conf"
  (umask 077; printf '{"url":"http://127.0.0.1:%s","username":"verify","password":"%s"}\n' "$PORT" "$pw" > "$SERVER_JSON")
  # Suwayomi caches pages and covers in <java.io.tmpdir>/Tachidesk; the default
  # /tmp is shared with the user's server, so a cache clear here would empty it.
  ( cd /tmp && setsid /usr/bin/suwayomi-server -Dsuwayomi.tachidesk.config.server.rootDir="$SERVER_DIR" -Djava.io.tmpdir="$SERVER_DIR/tmp" > "$RUN/server.log" 2>&1 < /dev/null & )
  for _ in $(seq 120); do
    v=$(gql '{"query":"{aboutServer{version}}"}' 2>/dev/null | jq -r '.data.aboutServer.version // empty' 2>/dev/null || true)
    if [ -n "$v" ]; then
      # The launcher wraps java, so record the process that owns the port.
      ss -ltnp | grep ":$PORT " | grep -o 'pid=[0-9]*' | head -1 | cut -d= -f2 > "$RUN/server.pid"
      echo "ready: Suwayomi $v on 127.0.0.1:$PORT (pid $(cat "$RUN/server.pid")), run dir $RUN"; exit 0
    fi
    sleep 2
  done
  echo "server did not answer in 240 s; see $RUN/server.log" >&2; exit 1 ;;
doctor)
  [ -f "$RUN/server.pid" ] || { echo "no server.pid in $RUN: not started by this run"; exit 1; }
  pid=$(cat "$RUN/server.pid")
  kill -0 "$pid" 2>/dev/null || { echo "pid $pid is not running"; exit 1; }
  owner=$(ss -ltnp | grep ":$PORT " | grep -o 'pid=[0-9]*' | head -1 | cut -d= -f2)
  [ "$owner" = "$pid" ] || { echo "port $PORT is owned by pid ${owner:-none}, not ours ($pid)"; exit 1; }
  unauth=$(curl -s -o /dev/null -w '%{http_code}' -X POST -H 'content-type: application/json' -d '{"query":"{aboutServer{version}}"}' "http://127.0.0.1:$PORT/api/graphql")
  v=$(gql '{"query":"{aboutServer{version}}"}' | jq -r '.data.aboutServer.version // empty')
  echo "ok: pid $pid owns $PORT, Suwayomi $v, unauthenticated request -> $unauth"
  [ -n "$v" ] && [ "$unauth" = 401 ] ;;
stop)
  if [ -f "$RUN/server.pid" ]; then
    pid=$(cat "$RUN/server.pid")
    kill "$pid" 2>/dev/null || true
    for _ in $(seq 20); do kill -0 "$pid" 2>/dev/null || break; sleep 1; done
    kill -9 "$pid" 2>/dev/null || true
  fi
  # The launcher's java child and the JCEF helpers outlive the recorded PID;
  # match them by this run's server dir, never by name.
  for p in /proc/[0-9]*; do
    n=${p#/proc/}; [ "$n" = "$$" ] && continue
    { tr '\0' ' ' < "$p/cmdline"; } 2>/dev/null | grep -qF -e "$SERVER_DIR/" -e "rootDir=$SERVER_DIR " && kill -9 "$n" 2>/dev/null || true
  done
  ss -ltn | grep -q ":$PORT " && { echo "port $PORT still open" >&2; exit 1; }
  rm -rf "$SERVER_DIR" "$SERVER_JSON" "$RUN/server.pid"
  echo "stopped; evidence kept in $EVIDENCE" ;;
*) echo "usage: server.sh start|doctor|stop" >&2; exit 2 ;;
esac
