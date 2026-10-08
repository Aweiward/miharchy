#!/usr/bin/env bash
# Quickshell commands against this run's window, with the run's runtime dir
# (drive.sh gives the window XDG_RUNTIME_DIR=$RUN/runtime; without it
# quickshell answers "No running instances").
#   qs.sh ipc call miharchy openUpdates   IPC to the window drive.sh runs ($RUN/app/window)
#   qs.sh list                            that window's instances, as JSON
#   qs.sh log <id>                        an instance's log ($RUN/runtime/quickshell/by-id/<id>)
#   qs.sh env <command ...>               any command with the window's environment (window_env in env.sh)
set -euo pipefail
source "$(dirname "$0")/env.sh"
cmd=${1:?ipc, list, log or env}; shift
case $cmd in
  ipc) window_env quickshell ipc -p "$RUN/app/window" "$@" ;;
  list) window_env quickshell list -j -p "${1:-$RUN/app/window}" ;;
  log) window_env quickshell log "$RUN/runtime/quickshell/by-id/$1/log.qslog" ;;
  env) window_env "$@" ;;
  *) echo "unknown command $cmd" >&2; exit 2 ;;
esac
