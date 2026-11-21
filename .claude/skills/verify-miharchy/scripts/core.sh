#!/usr/bin/env bash
# Scratch miharchy-core for verification (ADR 0010), beside the scratch Suwayomi.
#   core.sh start            build core/ if needed, start it on a free port (kept in $RUN/core/port),
#                            data and core.json under $RUN/core; a second start keeps that data
#   core.sh api <route> [json]  POST /api/<route>, the secret read from core.json and fed on stdin
#   core.sh seed             add the Keiyoushi repo and install MangaDex, so Browse has a source
#   core.sh stop             stop the instance this run started (by PID file); the data stays
#   core.sh wipe             stop it and delete $RUN/core
# Never the user's core: port 4591, ~/.config/miharchy/core.json, ~/.local/share/miharchy/core.
set -euo pipefail
source "$(dirname "$0")/env.sh"
CORE=$RUN/core
BIN=$REPO/core/server/build/install/miharchy-core/bin/miharchy-core

api() {
  local port; port=$(cat "$CORE/port")
  printf 'Authorization: Bearer %s' "$(jq -r .secret "$CORE/core.json")" \
    | curl -s -m 120 -H @- -H 'content-type: application/json' -X POST "http://127.0.0.1:$port/api/$1" -d "${2:-}"
}

up() { [ -f "$CORE/port" ] && ss -ltn | grep -q ":$(cat "$CORE/port") "; }

case "${1:-}" in
  start)
    up && { echo "already up on 127.0.0.1:$(cat "$CORE/port"), run dir $RUN"; exit 0; }
    [ -x "$BIN" ] || (cd "$REPO/core" && ./gradlew --no-daemon -q --console=plain :server:installDist)
    mkdir -p "$CORE"
    if [ ! -f "$CORE/port" ]; then
      port=$(python3 -c 'import socket; s=socket.socket(); s.bind(("127.0.0.1", 0)); print(s.getsockname()[1])')
      case "$port" in 4590|4591) echo "picked a real port; run start again" >&2; exit 1;; esac
      echo "$port" > "$CORE/port"
    fi
    ( cd /tmp && MIHARCHY_CORE_DATA=$CORE/data MIHARCHY_CORE_CONFIG=$CORE/core.json MIHARCHY_CORE_PORT=$(cat "$CORE/port") \
        setsid -f "$BIN" >> "$CORE/core.log" 2>&1 < /dev/null )
    for _ in $(seq 120); do
      if up; then
        ss -ltnp | grep ":$(cat "$CORE/port") " | grep -o 'pid=[0-9]*' | head -1 | cut -d= -f2 > "$CORE/pid"
        echo "ready: miharchy-core on 127.0.0.1:$(cat "$CORE/port") (pid $(cat "$CORE/pid")), config $CORE/core.json"; exit 0
      fi
      sleep 0.5
    done
    echo "core did not listen in 60 s; see $CORE/core.log" >&2; exit 1 ;;
  api) api "$2" "${3:-}" ;;
  seed)
    api extensionRepo.add '{"url":"https://raw.githubusercontent.com/keiyoushi/extensions/repo/index.min.json"}' > /dev/null
    api extension.install '{"pkgName":"eu.kanade.tachiyomi.extension.all.mangadex"}' | jq -c '{installed: .extension.isInstalled, version: .extension.versionName}' ;;
  stop|wipe)
    if [ -f "$CORE/pid" ]; then
      pid=$(cat "$CORE/pid"); kill "$pid" 2>/dev/null || true
      for _ in $(seq 20); do kill -0 "$pid" 2>/dev/null || break; sleep 0.5; done
      rm -f "$CORE/pid"
    fi
    [ "$1" = wipe ] && rm -rf "$CORE"
    echo "stopped${1/stop/}; run dir $RUN" ;;
  *) sed -n 2,9p "$0"; exit 1 ;;
esac
