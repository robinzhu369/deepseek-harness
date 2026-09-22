#!/usr/bin/env bash
set -euo pipefail

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
requested_runtime_root="${MODELING_DEMO_ROOT:-}"
requested_api_port="${MODELING_API_PORT:-}"
requested_web_port="${MODELING_WEB_PORT:-}"
if [[ -f "${MODELING_DEMO_ENV_FILE:-${repo_root}/.env}" ]]; then
  set -a
  source "${MODELING_DEMO_ENV_FILE:-${repo_root}/.env}"
  set +a
fi
[[ -z "${requested_runtime_root}" ]] || MODELING_DEMO_ROOT="${requested_runtime_root}"
[[ -z "${requested_api_port}" ]] || MODELING_API_PORT="${requested_api_port}"
[[ -z "${requested_web_port}" ]] || MODELING_WEB_PORT="${requested_web_port}"
runtime_root="${MODELING_DEMO_ROOT:-${repo_root}/.artifacts/modeling-demo/runtime}"
api_port="${MODELING_API_PORT:-8000}"
web_port="${MODELING_WEB_PORT:-3080}"

stop_process_tree() {
  local pid="$1"
  local child
  if command -v pgrep >/dev/null 2>&1; then
    for child in $(pgrep -P "${pid}" 2>/dev/null || true); do
      stop_process_tree "${child}"
    done
  fi
  kill -0 "${pid}" 2>/dev/null || return 0
  kill "${pid}"
  for _ in {1..50}; do
    kill -0 "${pid}" 2>/dev/null || return 0
    sleep 0.1
  done
  kill -KILL "${pid}"
}

stop_pid() {
  local name="$1"
  local pid_file="${runtime_root}/pids/${name}.pid"
  [[ -s "${pid_file}" ]] || return 0
  local pid
  pid="$(<"${pid_file}")"
  if [[ "${pid}" =~ ^[0-9]+$ ]] && kill -0 "${pid}" 2>/dev/null; then
    stop_process_tree "${pid}"
  fi
  rm -f "${pid_file}"
}

stop_orphan_listener() {
  local name="$1"
  local port="$2"
  command -v lsof >/dev/null 2>&1 || return 0
  local pid command cwd
  for pid in $(lsof -tiTCP:"${port}" -sTCP:LISTEN 2>/dev/null || true); do
    command="$(ps -p "${pid}" -o command= 2>/dev/null || true)"
    cwd="$(lsof -a -p "${pid}" -d cwd -Fn 2>/dev/null | sed -n 's/^n//p')"
    [[ "${cwd}" == "${repo_root}" ]] || continue
    if [[ "${name}" == "web" ]]; then
      [[ "${command}" == *"apps/cli/src/bin.ts"* && "${command}" == *"--profile web"* && "${command}" == *"packages/experimental/modeling/modeling.patch.yml"* ]] || continue
    else
      [[ "${command}" == *"uvicorn app.server:app"* && "${command}" == *"--port ${port}"* ]] || continue
    fi
    echo "modeling-demo-down: stopping orphaned ${name} listener pid=${pid} port=${port}"
    stop_process_tree "${pid}"
  done
}

stop_pid web
stop_pid api
stop_orphan_listener web "${web_port}"
stop_orphan_listener api "${api_port}"
echo "modeling-demo-down: stopped"
