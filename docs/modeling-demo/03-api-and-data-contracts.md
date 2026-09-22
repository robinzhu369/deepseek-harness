# 03 | API, Data, State, and Tool Contracts

English | [中文](03-api-and-data-contracts.zh.md)

This chapter defines the new domain protocol; it does not claim to be a Harness SDK. Machine-verifiable plan and event definitions live under `contracts/`. An implementation may generate models with Pydantic, but it must not maintain a separate frontend representation with different semantics.

## 3.1 Authoritative Data Sources

| Object | Single authoritative source | Important fields |
|---|---|---|
| Session/message | Existing Harness persistence | session_id, message events |
| Dataset | Python API SQLite | id, session_id, original_name, sha256, size_bytes, storage_key, state, profile_json |
| Plan | SQLite, immutable revision | id, revision, dataset_id, dataset_sha256, plan_json, plan_hash, skill_snapshots, state |
| Run | SQLite | id, kind, session_id, plan_id/revision, parent_run_id, status, node_states, revision, error, timestamps |
| Artifact | SQLite plus the actual file | id, run_id, kind, storage_key, sha256, size_bytes, media_type, completed |
| BusinessEvent | Ordered SQLite log | seq, run_id, node_id, type, payload, occurred_at |
| SkillVersion | Controlled file snapshot and index | name, version, content_hash, content, created_at, published_by |

`Run.kind=profile` can omit a Plan and provides only the read-only overview after upload. `Run.kind=modeling` must bind an approved Plan. Job and Run do not become duplicate state machines. The API coordinates SQLite writes; a Worker has no arbitrary business-state write authority.

The API records all times as UTC ISO-8601 and the frontend displays them in the local time zone. The Host must inject and verify each object's session_id from trusted context; it must not trust Session ownership declared in model-controlled tool parameters.

## 3.2 Private API (FastAPI, Not Published Directly to the Internet)

| Method and path | Request/response summary | Initiator |
|---|---|---|
| GET /v1/health | Service/version/Worker readiness; no credentials | Host/health check |
| GET /v1/capabilities | Allowed modes, operators, models, limits, upload formats | Host/UI |
| POST /v1/datasets | Streaming multipart file; returns dataset_id/profile_run_id | User upload forwarded by Host |
| GET /v1/datasets | Paginated items accessible to the current Session only | Data center |
| GET /v1/datasets/{id} | State and metadata | Page |
| GET /v1/datasets/{id}/profile | Profile plus computation_scope | Tool/page |
| GET /v1/datasets/{id}/preview?limit=20 | limit ≤100, paginated or cropped columns | Data drawer |
| POST /v1/plans | Candidate plan; returns validated id/revision/hash | Agent tool/form |
| PUT /v1/plans/{id} | Includes base_revision; creates a new revision | User edit |
| GET /v1/plans/{id}?revision=n | Returns an immutable version | Page/rerun |
| POST /v1/plans/{id}/approve-and-run | revision and plan_hash; Idempotency-Key required | User-confirmation path only |
| GET /v1/runs/{id} | Complete latest snapshot, revision, nodes, artifacts | Client-service polling |
| GET /v1/runs/{id}/events?after_seq=n | Paginated ordered events; optional enhancement | Log details |
| POST /v1/runs/{id}/cancel | Idempotent cancellation request | User |
| POST /v1/runs/{id}/rerun | Validated changes/plan revision; returns a new run | User |
| GET /v1/runs/{id}/result | metrics, manifest, warnings, artifact IDs | Tool/result card |
| GET /v1/artifacts/{id}/download | Authorization plus file transfer | User |
| GET /v1/skills | Four business Skills, published versions, draft state | Skill center |
| PUT /v1/skills/{name}/draft | Bounded Markdown instructions; no arbitrary paths | User |
| POST /v1/skills/{name}/validate | Structure, tool allowlist, and schema-reference checks | User |
| POST /v1/skills/{name}/publish | Draft hash and expected version; publishes an immutable snapshot | User |

Host-to-Python traffic uses local or private-network service authentication. The browser uses only the Harness authentication boundary and business Controller; it must not receive a shared service token in JavaScript. T00/T02 records the exact Remote, upload, and download mapping in `REPO_DISCOVERY.md`.

## 3.3 Common Errors and Idempotency

Error body:

```json
{
  "error": {
    "code": "PLAN_REVISION_CONFLICT",
    "message": "方案已更新，请刷新后重新确认。",
    "retryable": false,
    "details": {"expected_revision": 2, "received_revision": 1},
    "request_id": "req_example"
  }
}
```

Use 401/403 for authentication or authorization, 404 for absent or inaccessible resources, 409 for version or state conflicts, 413 for oversized files, 422 for invalid plans or fields, 429 for capacity limits, and 503 for temporary service unavailability. Logs retain request_id/run_id but do not include credentials, raw banking data, or arbitrary Host paths.

`approve-and-run` validates and registers work in one transaction. An idempotency key is scoped to the user/Session and operation; persistence records the request hash and response run_id. The same key and request return the same run; the same key with a different request returns 409. An in-progress plan is never rewritten in place.

## 3.4 Plan Validation: Schema Is Not Sufficient for Semantic Correctness

`contracts/modeling-plan.schema.json` restricts fields and algorithms and rejects `code`, `shell`, `sql`, and unknown parameters. Semantic validation also covers:

- dataset_id matches its hash and every referenced column exists; the target is not a feature and excluded columns exist.
- train/validation/test ratios total 1; binary-classification mode requires a target, positive_label, stratified random splitting, and at least one supported model.
- The binary target has exactly two non-empty classes, positive_label matches its value and type, and each split contains the required classes; otherwise return 422.
- P0 random splitting requires the user to confirm sample independence explicitly. For known repeated entities or time dependence, ask for supported data or wait for group/time splitting; a confirmation cannot remove the risk.
- `assumptions.samples_independent` records this data assumption. It is not an approval field and cannot authorize execution. Reject unknown candidate-plan fields such as `approved` or `execute`.
- Unlabeled `prepare_dataset` uses random splitting; labeled data may use stratified_random. Even without training, preserve the fit/transform boundary instead of using full-data statistics to create validation features that may later be misused.
- Date-feature inputs are parseable; One-Hot category count and final feature dimensions have limits; resource budgets do not exceed service limits.
- Skill hashes and published versions are audit material, not execution authority. Approval comes from a user action, not Skill instructions or model output.

The model candidate format is shown in `contracts/examples/valid-classification-plan.json`. It is example configuration, not an inference about a screenshot file.

## 3.5 Domain Tools: Four Are Sufficient

| Tool | Parameters | Result | Authority |
|---|---|---|---|
| modeling_get_dataset_profile | dataset_id | Summary, data issues, field information, computation_scope | Read-only |
| modeling_propose_plan | plan | plan_id, revision, hash, needs_confirmation | Saves a candidate plan only; does not execute |
| modeling_get_run_status | run_id | State, nodes, revision, warnings | Read-only |
| modeling_get_run_result | run_id | Real metrics, report summary, artifact IDs | Read-only |

session_id, identity, and service tokens do not appear in model-controlled parameters. Obtain them from the actual trusted Harness Tool Context field. Do not invent interfaces such as `ctx.sessionId` before T00 identifies the field.

Tool results contain `ok` plus either `data` or `error` and enforce a strict size limit. A result summary defaults to at most 12 KiB. Use artifact references for large files or complete logs instead of truncating until important information disappears. An error must not masquerade as successful text.

The tool allowlist excludes `approve`, `execute_arbitrary_code`, and `shell`. Disable or narrow existing general-purpose Harness tools in the business runtime preset; a Prompt instruction alone is insufficient.

## 3.6 State Machines and Events

Dataset: `uploaded → profiling → ready | error`.

Plan: `draft → proposed → approved`; an edit creates a new revision, previous revisions remain, and replaced revisions are marked superseded. Approval revalidates the hash.

Run:

```text
queued → running → succeeded
  │         ├── failed
  │         ├── cancelling → cancelled
  │         └── interrupted（服务/Worker 意外中止）
  └── cancelled
```

Cancellation races with completion: if the run has completed, return its terminal state; a cancellation marker must not replace existing successful artifacts with another version. Node states are pending/running/succeeded/failed/skipped/cancelled/interrupted/blocked. Downstream nodes blocked by an upstream failure use blocked, not succeeded.

Typical events: `run.queued`, `run.started`, `node.started`, `node.completed`, `node.failed`, `artifact.created`, `run.completed`, `run.failed`, `run.cancelled`, and `run.interrupted`. seq increases strictly within one run. The Client accepts only newer revisions so out-of-order polling cannot move a completed run back to running.

## 3.7 Execution and Atomic Files

A Worker receives only a frozen plan path/JSON, a resolved controlled data path, a work directory, and a resource budget. Start the process with an argument array; do not construct a shell command string.

Each run owns one directory. Write outputs to `.partial`, then fsync/close and atomically replace the final file on success. Register an artifact only after validation. Partial files cannot be downloaded. Report-generation failure does not erase completed compute artifacts, but it must produce a warning.

On service restart, mark leftover running/cancelling work interrupted and revalidate queued work before restoring it to the queue. Training does not promise checkpoint resumption. Browser refresh restores only UI and state and must not start duplicate work.

## 3.8 Artifact Specification

```text
data/datasets/{dataset_id}/raw.csv
data/datasets/{dataset_id}/profile.json
data/runs/{run_id}/plan.json
data/runs/{run_id}/split_manifest.json
data/runs/{run_id}/feature_manifest.json
data/runs/{run_id}/train.parquet
data/runs/{run_id}/validation.parquet
data/runs/{run_id}/test.parquet
data/runs/{run_id}/preprocessor.joblib
data/runs/{run_id}/pipeline.joblib       # 仅训练模式
data/runs/{run_id}/metrics.json          # 仅训练模式
data/runs/{run_id}/report.md
```

Do not densify a large sparse One-Hot matrix merely to export it. A small demo may export bounded-density Parquet. Above the threshold, use CSR `.npz` plus feature names and labels and record the format in the manifest. CSV is optional and must explicitly defend against Excel formula injection. Expanding a large sparse matrix until it causes OOM is prohibited. [S12]

Record the data checksum, split seed, original row identity, training-row count, feature order, preprocessing version, Skill snapshot, dependency versions, and plan hash. Reproducibility does not imply bit-for-bit identity across platforms.
