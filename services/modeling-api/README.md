# Modeling Demo API worker

English | [中文](README.zh.md)

## Summary

This service validates bounded modeling plans, stores datasets and job state in SQLite, profiles uploaded CSV files in the background, and runs the deterministic logistic regression pipeline in an independent Python process. Dataset files and completed run artifacts remain on disk under the configured service root.

## Run the HTTP lifecycle

From the repository root, choose a new output directory and exercise upload, profiling, approval, execution, and result retrieval:

```sh
T05_DIR="$(mktemp -d /private/tmp/modelx-t05.XXXXXX)"
python3 services/modeling-api/run_t05_demo.py --output-root "$T05_DIR/output" --rows 1200 --seed 20260920
```

The runner refuses to overwrite an existing output root. Its summary names the persisted dataset, plan revision, run, metrics, model, and manifest produced by the worker.

## Run G1 directly

Use the direct runner when only the fixed data-science pipeline needs verification:

```sh
G1_DIR="$(mktemp -d /private/tmp/modelx-g1.XXXXXX)"
python3 services/modeling-api/run_g1_demo.py --output-root "$G1_DIR/output" --rows 1200 --seed 20260920
python3 services/modeling-api/verify_g1_artifacts.py "$G1_DIR/output/run"
```

The verifier checks artifact hashes, split isolation, model reload, and metrics recomputation from the saved test predictions.

## Test

Run the Python contracts, pipeline, upload, profile, approval, persistence, cancellation, and artifact tests, then compile and lint the browser-safe TypeScript records:

```sh
python3 -m pytest services/modeling-api/tests -q
pnpm exec tsc --project services/modeling-api/tsconfig.json
pnpm exec oxlint services/modeling-api/contracts --deny-warnings
```

## Runtime guarantees

Uploads are read in bounded chunks, validated as UTF-8 CSV, hashed, and stored without trusting their filename or MIME type. Profile responses identify the dataset and its SHA-256 so a model can propose a pinned plan, then contain aggregate statistics and at most the configured preview limit; they never contain the complete dataset.

Approval requires an idempotency key plus the current plan revision and hash. Proposed plans retain the Host-computed runtime Skill version and digest snapshots. SQLite owns run state and ordered events, one modeling process may run at a time, cancellation records `run.cancelling` before terminating the owned process group, and the service registers artifacts only after the worker publishes and verifies complete output. The pipeline uses a valid input `record_id` when present and otherwise creates deterministic internal row IDs; both remain outside model features. A failed node's structured error becomes the Run error instead of a generic worker-exit message. Result records include bounded split and feature summaries, ROC-AUC, average precision, F1, precision, recall, the confusion matrix, the threshold, and evidence-linked diagnostic and recommendation codes without returning training-record identifiers.

The Skill API manages exactly five runtime modeling Skills. Drafts belong to one Session, validation restricts frontmatter, size, tool names, and requested capabilities, and publishing writes an immutable version before making it active. Existing plan and run records keep their original Skill snapshots; a new plan receives the active versions.

Plan edits create a proposed revision and record the semantic downstream stages affected by the change. A plan may carry an optional `task_context` with the dataset identity, ordered enabled Skills, user preferences, reused profile evidence, and evidence-backed decisions; legacy plans without it remain readable. The API rejects duplicate or unsafe Skill orderings, unsupported algorithms, and date-derived features before a plan can be confirmed. The current worker does not reuse a stage cache, so every accepted rerun honestly recomputes the full pipeline. A rerun requires the exact revision, hash, source run, and idempotency key; it always creates a new run ID while preserving the prior run.

`GET /v1/workspace` restores the latest dataset, plan, run, node events, result, warnings, and completed artifact metadata owned by one Session. It replaces each storage key with the service-relative Run directory and filename needed for display, removes worker process fields, and never creates or resumes work.

## Known limitations

This private service does not expose Agent tools or a browser UI. The experimental modeling Host adapter supplies the trusted session header and keeps the API origin outside model arguments; deployments must restrict the private origin to the Host because the API has no separate service token. Worker limits enforce single concurrency and wall-clock timeout, but do not yet apply an operating-system CPU or memory quota. Million-row capacity checks remain separate verification work.
