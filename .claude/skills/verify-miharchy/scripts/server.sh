#!/usr/bin/env bash
# Scratch Suwayomi-Server for verification.
#   server.sh start    start it on a free port (kept in $RUN/port), write $RUN/server.json, wait until GraphQL answers
#   server.sh doctor   read-only: is our instance up, on our port, answering with our credentials?
#   server.sh restart  stop and start the same instance: same port, credentials and library
#   server.sh stop     stop the instance this run started (by PID file), keep $RUN/evidence
#   server.sh clean    remove the window copy ($RUN/app), run home ($RUN/home), runtime dir ($RUN/runtime) and restart clones ($RUN/rs), keep $RUN/evidence
set -euo pipefail
source "$(dirname "$0")/env.sh"

gql() { curl -s -m 30 -H "Authorization: Bearer $(token)" -H 'content-type: application/json' -X POST -d "$1" "http://127.0.0.1:$PORT/api/graphql"; }

# Suwayomi caches pages and covers in <java.io.tmpdir>/Tachidesk; the default
# /tmp is shared with the user's server, so a cache clear here would empty it.
# setsid -f forks and returns at once: no shell is left waiting on the server
# with the caller's stdout, so `start | cat` and a backgrounded start both end.
launch() {
  ( cd /tmp && setsid -f /usr/bin/suwayomi-server -Dsuwayomi.tachidesk.config.server.rootDir="$SERVER_DIR" -Djava.io.tmpdir="$SERVER_DIR/tmp" >> "$RUN/server.log" 2>&1 < /dev/null )
  for _ in $(seq 120); do
    v=$(gql '{"query":"{aboutServer{version} mangas{totalCount}}"}' 2>/dev/null | jq -r '.data.aboutServer.version // empty' 2>/dev/null || true)
    if [ -n "$v" ]; then
      # The launcher wraps java, so record the process that owns the port.
      ss -ltnp | grep ":$PORT " | grep -o 'pid=[0-9]*' | head -1 | cut -d= -f2 > "$RUN/server.pid"
      echo "ready: Suwayomi $v on 127.0.0.1:$PORT (pid $(cat "$RUN/server.pid")), run dir $RUN"; return 0
    fi
    sleep 2
  done
  echo "server did not answer in 240 s; see $RUN/server.log" >&2; return 1
}

halt() {
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
  [ -n "$PORT" ] && ss -ltn | grep -q ":$PORT " && { echo "port $PORT still open" >&2; return 1; }
  rm -f "$RUN/server.pid"
}

case "${1:-}" in
start)
  # Another run's live server in this dir would be killed by our stop; refuse to share it.
  if [ -f "$RUN/server.pid" ] && kill -0 "$(cat "$RUN/server.pid")" 2>/dev/null; then
    echo "$RUN already has a running server (pid $(cat "$RUN/server.pid")); set your own MIHARCHY_VERIFY_DIR" >&2; exit 1
  fi
  if [ -n "${MIHARCHY_VERIFY_PORT:-}" ]; then
    PORT=$MIHARCHY_VERIFY_PORT
    ss -ltn | grep -q ":$PORT " && { echo "port $PORT is taken; pick another MIHARCHY_VERIFY_PORT" >&2; exit 1; }
  else
    # A free port that no sibling run has picked: a sibling still starting has not bound its port yet.
    used=$({ ss -ltnH | awk '{print $4}' | sed 's/.*://'; cat "$(dirname "$RUN")"/*/port 2>/dev/null || true; } | sort -u)
    PORT=$(comm -23 <(seq 4591 4999 | sort) <(echo "$used") | shuf -n 1)
  fi
  install -d -m 700 "$RUN" "$SERVER_DIR" "$SERVER_DIR/tmp" "$EVIDENCE"
  echo "$PORT" > "$RUN/port"
  pw=$(openssl rand -hex 16)
  printf 'server.ip = "127.0.0.1"\nserver.port = %s\nserver.webUIEnabled = false\nserver.systemTrayEnabled = false\nserver.authMode = "ui_login"\nserver.authUsername = "verify"\nserver.authPassword = "%s"\nserver.jwtTokenExpiry = "%s"\n' "$PORT" "$pw" "${MIHARCHY_VERIFY_TOKEN_EXPIRY:-5m}" > "$SERVER_DIR/server.conf"
  (umask 077; printf '{"url":"http://127.0.0.1:%s","username":"verify","password":"%s"}\n' "$PORT" "$pw" > "$SERVER_JSON")
  : > "$RUN/server.log"
  launch ;;
restart)
  [ -f "$RUN/server.pid" ] || { echo "no server.pid in $RUN: not started by this run" >&2; exit 1; }
  halt
  launch ;;
doctor)
  [ -f "$RUN/server.pid" ] || { echo "no server.pid in $RUN: not started by this run"; exit 1; }
  pid=$(cat "$RUN/server.pid")
  kill -0 "$pid" 2>/dev/null || { echo "pid $pid is not running"; exit 1; }
  owner=$(ss -ltnp | grep ":$PORT " | grep -o 'pid=[0-9]*' | head -1 | cut -d= -f2)
  [ "$owner" = "$pid" ] || { echo "port $PORT is owned by pid ${owner:-none}, not ours ($pid)"; exit 1; }
  # ui_login answers a request without a token with 200 and an Unauthorized error.
  unauth=$(curl -s -X POST -H 'content-type: application/json' -d '{"query":"{mangas{totalCount}}"}' "http://127.0.0.1:$PORT/api/graphql" | jq -r '.errors[0].message // "data" | split("\r")[0] | sub(".* : "; "")')
  v=$(gql '{"query":"{aboutServer{version} mangas{totalCount}}"}' | jq -r '.data.aboutServer.version // empty')
  echo "ok: pid $pid owns $PORT, Suwayomi $v, request without a token -> $unauth, run dir $RUN"
  [ -n "$v" ] && [ "$unauth" = Unauthorized ] ;;
stop)
  halt
  rm -rf "$SERVER_DIR" "$SERVER_JSON" "$RUN/port"
  echo "stopped; evidence kept in $EVIDENCE" ;;
clean)
  rm -rf "$RUN/app" "$RUN/home" "$RUN/runtime" "$RUN/rs"
  echo "removed the window copy, run home, runtime dir and restart clones; evidence kept in $EVIDENCE" ;;
*) echo "usage: server.sh start|doctor|restart|stop|clean" >&2; exit 2 ;;
esac
