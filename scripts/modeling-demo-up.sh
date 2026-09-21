#!/usr/bin/env bash
set -euo pipefail

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
if [[ -f "${MODELING_DEMO_ENV_FILE:-${repo_root}/.env}" ]]; then
  set -a
  source "${MODELING_DEMO_ENV_FILE:-${repo_root}/.env}"
  set +a
fi

runtime_root="${MODELING_DEMO_ROOT:-${repo_root}/.artifacts/modeling-demo/runtime}"
harness_home="${MODELING_DEMO_HARNESS_HOME:-${runtime_root}/harness-home}"
api_port="${MODELING_API_PORT:-8000}"
web_port="${MODELING_WEB_PORT:-3080}"
mkdir -p "${runtime_root}/logs" "${runtime_root}/pids" "${harness_home}"

if [[ -s "${runtime_root}/pids/api.pid" || -s "${runtime_root}/pids/web.pid" ]]; then
  echo "modeling-demo-up: pid files already exist; run scripts/modeling-demo-down.sh first" >&2
  exit 1
fi

export DSH_HOME="${harness_home}"
export MODELING_API_ROOT="${MODELING_API_ROOT:-${runtime_root}/service}"
export MODELING_API_URL="${MODELING_API_URL:-http://127.0.0.1:${api_port}}"

(
  cd "${repo_root}"
  nohup env PYTHONPATH=services/modeling-api python3 -m uvicorn app.server:app --host 127.0.0.1 --port "${api_port}" \
    >"${runtime_root}/logs/modeling-api.log" 2>&1 &
  printf '%s\n' "$!" >"${runtime_root}/pids/api.pid"
)

(
  cd "${repo_root}"
  nohup pnpm dsh --profile web --patch apps/web/tests/pin-browse-picker.overlay.yml --patch packages/experimental/modeling/modeling.patch.yml --port "${web_port}" --no-open \
    >"${runtime_root}/logs/harness-web.log" 2>&1 &
  printf '%s\n' "$!" >"${runtime_root}/pids/web.pid"
)

web_url=""
for _ in {1..100}; do
  web_url="$(sed -n 's/^dsh web: \(http[^[:space:]]*\)$/\1/p' "${runtime_root}/logs/harness-web.log" | tail -n 1)"
  [[ -z "${web_url}" ]] || break
  web_pid="$(<"${runtime_root}/pids/web.pid")"
  kill -0 "${web_pid}" 2>/dev/null || break
  sleep 0.1
done
if [[ -z "${web_url}" ]]; then
  echo "modeling-demo-up: authenticated Harness Web URL was not found in ${runtime_root}/logs/harness-web.log" >&2
  MODELING_DEMO_ROOT="${runtime_root}" "${repo_root}/scripts/modeling-demo-down.sh"
  exit 1
fi

if ! MODELING_DEMO_ROOT="${runtime_root}" MODELING_API_PORT="${api_port}" MODELING_WEB_PORT="${web_port}" "${repo_root}/scripts/modeling-demo-health.sh" --wait; then
  MODELING_DEMO_ROOT="${runtime_root}" "${repo_root}/scripts/modeling-demo-down.sh"
  exit 1
fi

echo "modeling-demo-up: ready"
echo "Harness Web: ${web_url}"
echo "Modeling API: http://127.0.0.1:${api_port}/openapi.json"
echo "Logs: ${runtime_root}/logs"
