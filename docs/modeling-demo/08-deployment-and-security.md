# 08 | Private-Network Deployment, Execution Security, and Reproducibility

English | [中文](08-deployment-and-security.zh.md)

## 8.1 Verify Two Boundaries Separately

Codex, external design Skills, and browser tools belong to the development environment. Harness, Python, and business Skills belong to the delivered runtime. A system that can run on a private network does not imply permission to send source code or banking data to cloud-hosted Codex. Development uses only approved code and synthetic data and follows the organization's authorization for data and code use.

The runtime selects an existing approved private-network Provider rather than hardcoding a public model. Configuration keys, API protocol, and tool-calling parameters follow the pinned Harness version. Test a real tool call and structured candidate plan, not only a "hello" response.

## 8.2 Recommended Deployment Entry Point

Prefer one Linux host or dedicated VM. Existing Nginx is the browser entry point, Harness and the Python API listen on controlled addresses, and compute subprocesses run locally. Only the browser entry point is exposed to the target network; users cannot access the Python API directly.

When Docker Compose is required, preserve the same trust boundaries and build separately pinned images. The reviewed Harness Web version constrains listening addresses, Host, and Origin; do not copy a generic service's `--host 0.0.0.0`. T00 confirms the actual behavior for the pinned version. [S16]

One deployable option gives Harness and the reverse proxy a shared network namespace so the proxy can reach Harness loopback. Another runs both processes on one dedicated VM behind existing Nginx. Do not assume an ordinary Docker bridge can reach another container's 127.0.0.1.

The gateway preserves upstream authentication, Host/Origin validation, WebSocket upgrades, and correct proxy headers and adds only an explicit trusted entry point. An outer authentication layer may supplement access control, but Basic Auth does not replace Harness access control. Do not expose the service publicly before validating the proxy and authentication.

Codex generates the P0 deployment script only after validating it in the actual environment. This kit does not present an unverified complete Compose file as an out-of-box system.

## 8.3 Offline Delivery Materials

Pin the source commit, Node/pnpm, Python and dependency lockfiles, frontend build artifacts, required native dependencies, image digests, published business-Skill snapshots, and development-only browser test dependencies. Build and review while connected, then import through the organization's private-network process. Runtime never installs from pip/npm online.

Provide API keys through server-side environment or controlled credential storage, never the frontend bundle or Git. A version inventory must not present a file blob SHA as a repository commit SHA.

Offline validation blocks public-network access while retaining approved private-network models/services. Run the complete demo and inspect request logs. Disable outbound telemetry, automatic plugin updates, automatic search, and external MCP. Record any remaining network dependency; one environment variable alone does not establish offline deployment.

## 8.4 Worker Authority and Limits

Use a non-root user and minimal data-directory read/write permissions. Do not mount the Host home, SSH keys, Docker socket, or an entire enterprise share. A Worker holds no LLM/provider credential and provides no arbitrary code execution, arbitrary network tool, or dynamic untrusted-plugin import.

Pass subprocess arguments as a list with `shell=False` and run only reviewed repository entry points. Before execution, verify that paths remain under controlled roots and defend against symlinks and traversal. Default to one concurrent compute task and limit input size, output size, feature count, thread count, and per-step/total duration.

The parent process measures timeouts, terminates the process group, waits for exit, and then releases resources. Deployment enforces container/system memory limits; a `memory_limit` JSON field is not a hard limit by itself. An ordinary container is not a complete sandbox for arbitrary hostile code, so the Demo does not accept model-generated arbitrary code.

## 8.5 Suggested Defaults (Configurable, Not Measurements)

| Item | Demo default | Meaning |
|---|---|---|
| Concurrent computation | 1 | Training does not block Web |
| Regular upload | 100 MiB | Capacity tests increase it explicitly; gateway/API stay aligned |
| Data preview | 20 rows | Server hard limit is 100 |
| Model summary | ≤12 KiB tool result | Full data never enters context |
| One LLM request | 120 seconds total, at most one bounded retry | Validate the actual gateway/reasoning mode |
| Baseline training | 120 seconds | Timeout reports failure and never fabricates metrics |
| Total run | 600 seconds | Adjustable for the demo machine |
| One-Hot category limit | 32 per column | Matches schema; bounded adjustment allowed |
| Final feature limit | 10,000 | Reject explicitly or require user adjustment above the limit |
| Polling | About 1 second on active pages | Slow when hidden and stop at terminal state |

## 8.6 Recovery and Audit

At startup, reconcile leftover active runs: when no trusted Worker remains active, mark the run interrupted; queued work may be restored to the queue. Do not infer success from a temporary file. Cleanup of leftover `.partial` files may be deferred, but artifact reads verify completion state and hash.

Audit user confirmation, plan versions, data hashes, Skill hashes, tool calls, execution results, and downloads. Do not record hidden reasoning or complete sensitive rows. Retain request_id/run_id for diagnosis.

## 8.7 Minimum Security Checks Before Release

An unconfirmed plan cannot execute; the LLM has no approval tool; runtime cannot see development Skills; the Python API has no public port; downloads cannot cross authorization or path boundaries; pages contain no external scripts/CDNs; real credentials do not appear in logs, screenshots, or static files; errors, cancellation, and restart cannot produce false success.
