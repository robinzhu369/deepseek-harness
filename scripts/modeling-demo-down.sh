#!/usr/bin/env bash
set -euo pipefail

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
runtime_root="${MODELING_DEMO_ROOT:-${repo_root}/.artifacts/modeling-demo/runtime}"

stop_pid() {
  local name="$1"
  local pid_file="${runtime_root}/pids/${name}.pid"
  [[ -s "${pid_file}" ]] || return 0
  local pid
  pid="$(<"${pid_file}")"
  if [[ "${pid}" =~ ^[0-9]+$ ]] && kill -0 "${pid}" 2>/dev/null; then
    kill "${pid}"
    for _ in {1..50}; do
      kill -0 "${pid}" 2>/dev/null || break
      sleep 0.1
    done
    if kill -0 "${pid}" 2>/dev/null; then
      kill -KILL "${pid}"
    fi
  fi
  rm -f "${pid_file}"
}

stop_pid web
stop_pid api
echo "modeling-demo-down: stopped"
