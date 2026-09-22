# Modeling Demo Deployment and Startup

English | [中文](DEPLOYMENT.zh.md)

This page is the sole entry point for starting local demos. All commands must be executed from the repository root directory.

## Prerequisites

- macOS or Linux; this frozen environment uses macOS 26.6.2 arm64, with 10 cores and 24 GiB RAM.
- Node.js 26.9.0, pnpm 11.7.0, Python 3.10.20.
- Executed `pnpm install --frozen-lockfile`; the Python environment includes FastAPI 0.128.8, Uvicorn 0.51.0, Polars 1.0.0, and scikit-learn 1.4.0.
- DeepSeek official API credentials. The model provider is `deepseek-official`, with the model ID set to `deepseek-flash` (displayed as DeepSeek-V41-Flash in the interface).

## Configuration

Copy `.env.example` to `.env` and fill in `DEEPSEEK_API_KEY` locally; do not commit `.env`. Optional variables include `DEEPSEEK_BASE_URL`, `MODELING_DEMO_ROOT`, `MODELING_DEMO_HARNESS_HOME`, API/Web ports, upload limits, chunk sizes, preview limits, worker timeouts, and cancellation grace periods. Demo directories and ports explicitly passed in the command-line environment take precedence over `.env` settings, enabling isolated startups or temporary avoidance of port conflicts. The default upload limit is 100 MiB; million-row capacity tests use a separate 2 GiB test configuration without altering demo defaults.

## Startup and Health Checks

```bash
scripts/modeling-demo-up.sh
scripts/modeling-demo-health.sh
```

The startup script launches the Harness Web/Host, Modeling API, and a single-concurrency background worker within the API. The script waits up to 10 seconds for Harness to write the authentication address before performing service health checks; any failure stops the current startup process immediately. Open the full `Harness Web:` URL printed by the startup script without removing the `?token=...` query parameter. The default API OpenAPI endpoint is `http://127.0.0.1:8000/openapi.json`. In health check output, the API must return 200; web probes not carrying a token may receive 401. Both PIDs must remain alive. Logs are located at `${MODELING_DEMO_ROOT}/logs/`.

## Shutdown

```bash
scripts/modeling-demo-down.sh
```

## Data Directory and Reset

Default data resides in `.artifacts/modeling-demo/runtime/`: `service/` stores SQLite, Dataset, and Run artifacts; `harness-home/` saves local Harness sessions; `logs/` and `pids/` store runtime evidence. Always run the down script first. Once you confirm no historical evidence needs retention, manually move the entire `runtime` directory to a backup location to achieve an empty environment. The startup script does not automatically delete data.

## Common Errors

- `MISSING_CREDENTIAL`: Set `DEEPSEEK_API_KEY` in the root `.env`, or configure the DeepSeek official provider via the Harness credential page, then restart.
- PID file exists: Run down first; if a process exited abnormally, verify against PIDs and logs before manually cleaning up the corresponding PID files.
- Port already in use: The startup script reports conflicting ports and identifiable occupying processes before creating new ones. `modeling-demo-down.sh` reclaims leftover demo listening processes matching both command-line arguments and ports within the current repository but does not terminate services started from other directories or via different commands; alternatively, select different ports using `MODELING_API_PORT` or `MODELING_WEB_PORT`.
- Cannot find authentication address: Check `logs/harness-web.log`; this indicates an abnormal exit before Harness could output the authentication URL. The startup script stops the API and Web processes it created and does not consider other port listeners as part of a successful startup.
- `dsh web authentication required`: Open the full `Harness Web:` URL printed by `modeling-demo-up.sh`. Accessing the root address without `?token=...` returns 401, which indicates an expected state rather than service unavailability.
- Dataset not found: Datasets are isolated by their complete Harness Agent ID; during upload, `X-Session-Id` must match the Agent ID exactly, including the `session-` prefix.
- Upload too large: Adjust `MODELING_API_MAX_UPLOAD_BYTES` in your local `.env` and restart; do not bypass server-side limits.
- Run not started: Only "Confirm & Execute" or "Re-execute" buttons on the interface can approve runs; Agent tools lack approval capabilities.
