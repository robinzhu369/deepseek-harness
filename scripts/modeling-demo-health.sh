#!/usr/bin/env bash
set -euo pipefail

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
runtime_root="${MODELING_DEMO_ROOT:-${repo_root}/.artifacts/modeling-demo/runtime}"
api_port="${MODELING_API_PORT:-8000}"
web_port="${MODELING_WEB_PORT:-3080}"
attempts=1
if [[ "${1:-}" == "--wait" ]]; then
  attempts=100
fi

for ((attempt = 1; attempt <= attempts; attempt += 1)); do
  api_status="$(curl -sS -o /dev/null -w '%{http_code}' "http://127.0.0.1:${api_port}/openapi.json" 2>/dev/null || true)"
  web_status="$(curl -sS -o /dev/null -w '%{http_code}' "http://127.0.0.1:${web_port}/" 2>/dev/null || true)"
  api_pid="$(cat "${runtime_root}/pids/api.pid" 2>/dev/null || true)"
  web_pid="$(cat "${runtime_root}/pids/web.pid" 2>/dev/null || true)"
  if [[ "${api_status}" == "200" && ( "${web_status}" == "200" || "${web_status}" == "401" ) ]] \
    && kill -0 "${api_pid}" 2>/dev/null && kill -0 "${web_pid}" 2>/dev/null; then
    printf '{"status":"ready","api_http":%s,"web_http":%s,"api_pid":%s,"web_pid":%s}\n' \
      "${api_status}" "${web_status}" "${api_pid}" "${web_pid}"
    exit 0
  fi
  sleep 0.1
done

printf '{"status":"not_ready","api_http":"%s","web_http":"%s"}\n' "${api_status:-000}" "${web_status:-000}" >&2
exit 1
