#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
VENV_ACTIVATE="$ROOT_DIR/.venv/bin/activate"
RUN_DIR="$ROOT_DIR/.run"
LOG_DIR="$RUN_DIR/logs"

mkdir -p "$RUN_DIR" "$LOG_DIR"

if [[ ! -f "$VENV_ACTIVATE" ]]; then
  echo "Missing virtualenv activate script: $VENV_ACTIVATE" >&2
  exit 1
fi

usage() {
  cat <<EOF
Usage: $(basename "$0") <start|stop|restart|status|logs>

Environment overrides:
  SUPPRESS_RING_POLL_REQUEST_LOGS   default: 1
  RING_SERVER_BASE                  default: http://localhost:8080
  RING_OPEN_RETRY_SEC               default: 1
  RING_MONITOR_VERBOSE              default: 0 (set to 1 for --verbose)
  RING_DEBUG                        default: 0 (set to 1 for ring debug mode)
EOF
}

pid_file_for() {
  local name="$1"
  echo "$RUN_DIR/${name}.pid"
}

log_file_for() {
  local name="$1"
  echo "$LOG_DIR/${name}.log"
}

is_pid_running() {
  local pid="$1"
  [[ -n "$pid" ]] && kill -0 "$pid" 2>/dev/null
}

start_service() {
  local name="$1"
  shift

  local pid_file
  local log_file
  pid_file="$(pid_file_for "$name")"
  log_file="$(log_file_for "$name")"

  if [[ -f "$pid_file" ]]; then
    local old_pid
    old_pid="$(cat "$pid_file" 2>/dev/null || true)"
    if is_pid_running "$old_pid"; then
      echo "[$name] already running (pid $old_pid)"
      return 0
    fi
    rm -f "$pid_file"
  fi

  echo "[$name] starting..."
  (
    cd "$ROOT_DIR"
    source "$VENV_ACTIVATE"
    exec "$@"
  ) >>"$log_file" 2>&1 &

  local pid=$!
  echo "$pid" >"$pid_file"

  sleep 0.8
  if ! is_pid_running "$pid"; then
    echo "[$name] failed to start. Recent logs:"
    tail -n 40 "$log_file" || true
    rm -f "$pid_file"
    return 1
  fi

  echo "[$name] started (pid $pid) log=$log_file"
}

stop_pid() {
  local pid="$1"
  local timeout_seconds="${2:-3}"
  if ! is_pid_running "$pid"; then
    return 0
  fi

  kill "$pid" 2>/dev/null || true
  local start_ts
  start_ts="$(date +%s)"
  while is_pid_running "$pid"; do
    if (( "$(date +%s)" - start_ts >= timeout_seconds )); then
      break
    fi
    sleep 0.1
  done

  if is_pid_running "$pid"; then
    kill -9 "$pid" 2>/dev/null || true
  fi
}

stop_service() {
  local name="$1"
  local pid_file
  pid_file="$(pid_file_for "$name")"
  if [[ ! -f "$pid_file" ]]; then
    return 0
  fi

  local pid
  pid="$(cat "$pid_file" 2>/dev/null || true)"
  if [[ -n "$pid" ]]; then
    echo "[$name] stopping pid $pid..."
    stop_pid "$pid"
  fi
  rm -f "$pid_file"
}

kill_matching_pattern() {
  local pattern="$1"
  local label="$2"
  local pids
  pids="$(pgrep -f "$pattern" || true)"
  if [[ -z "$pids" ]]; then
    return 0
  fi

  while IFS= read -r pid; do
    [[ -z "$pid" ]] && continue
    echo "[$label] killing leftover pid $pid (pattern: $pattern)"
    stop_pid "$pid" 1
  done <<<"$pids"
}

start_all() {
  local suppress_ring_poll_logs="${SUPPRESS_RING_POLL_REQUEST_LOGS:-1}"
  local ring_monitor_verbose="${RING_MONITOR_VERBOSE:-0}"
  local ring_open_retry_sec="${RING_OPEN_RETRY_SEC:-1}"

  if [[ "${RING_DEBUG:-0}" == "1" ]]; then
    suppress_ring_poll_logs="0"
    ring_monitor_verbose="1"
    ring_open_retry_sec="0.5"
    echo "[debug] RING_DEBUG=1 -> poll access logs ON, ring monitor verbose ON"
  fi

  start_service \
    "bionic" \
    env SUPPRESS_RING_POLL_REQUEST_LOGS="$suppress_ring_poll_logs" RING_POLL_DEBUG="${RING_DEBUG:-0}" python3 servers/bionic/app.py

  start_service \
    "audio" \
    python3 servers/audio/server.py

  local ring_cmd=(
    python3
    servers/bionic/ring_monitor.py
    --server-base "${RING_SERVER_BASE:-http://localhost:8080}"
    --open-retry-sec "$ring_open_retry_sec"
  )
  if [[ "$ring_monitor_verbose" == "1" ]]; then
    ring_cmd+=(--verbose)
  fi

  start_service "ring_monitor" "${ring_cmd[@]}"

  echo ""
  status_all
  echo ""
  echo "Use: $(basename "$0") logs"
}

stop_all() {
  stop_service "ring_monitor"
  stop_service "audio"
  stop_service "bionic"

  # Cleanup any leftovers started outside this script.
  kill_matching_pattern "servers/bionic/ring_monitor.py" "ring_monitor"
  kill_matching_pattern "servers/audio/server.py" "audio"
  kill_matching_pattern "servers/bionic/app.py" "bionic"

  echo "All services stopped."
}

status_all() {
  local names=("bionic" "audio" "ring_monitor")
  for name in "${names[@]}"; do
    local pid_file
    pid_file="$(pid_file_for "$name")"
    local log_file
    log_file="$(log_file_for "$name")"
    if [[ -f "$pid_file" ]]; then
      local pid
      pid="$(cat "$pid_file" 2>/dev/null || true)"
      if is_pid_running "$pid"; then
        echo "[$name] running pid=$pid log=$log_file"
      else
        echo "[$name] stale pid file (not running) pid=$pid"
      fi
    else
      echo "[$name] not running"
    fi
  done
}

logs_all() {
  touch "$(log_file_for bionic)" "$(log_file_for audio)" "$(log_file_for ring_monitor)"
  echo "Tailing logs (Ctrl+C to stop)..."
  tail -n 120 -f \
    "$(log_file_for bionic)" \
    "$(log_file_for audio)" \
    "$(log_file_for ring_monitor)"
}

main() {
  local cmd="${1:-}"
  case "$cmd" in
    start)
      start_all
      ;;
    stop)
      stop_all
      ;;
    restart)
      stop_all
      start_all
      ;;
    status)
      status_all
      ;;
    logs)
      logs_all
      ;;
    *)
      usage
      exit 1
      ;;
  esac
}

main "$@"
