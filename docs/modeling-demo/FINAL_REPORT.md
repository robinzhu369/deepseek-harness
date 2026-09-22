# DeepSeek Harness Final Report for Smart Model Workbench

English | [中文](FINAL_REPORT.zh.md)

## Goals and Architecture

The Smart Model Workbench completes a demonstrable closed loop within the DeepSeek Harness: "Upload → Profile → Real Agent/Skill Planning → Proposed Plan → UI Modification → Human Confirmation → Independent Worker → Result/Artifact → Rerun/History". It leverages existing Harness Sessions, Agents, Host/Remote Adapters, React Slots, and plugin lifecycles. The Python Modeling API manages SQLite, Datasets, Plans, Runs, Artifacts, and fixed computation pipelines.

## Implemented Capabilities

Data uploads utilize chunked disk writes with SHA-256 hashing and Session isolation. Profile returns full scan aggregation plus a maximum of 20-row preview. Planning employs revision/hash tracking, whitelisted operators/model parameters, and optimistic concurrency control. The LLM can only read Profiles, propose Plans, check Run statuses/results; approval mechanisms, Shell access, Python execution, SQL queries, and arbitrary network tools remain invisible to the model. After human confirmation, an independent Python subprocess executes a split-before-fit pipeline; artifacts are registered upon completion.

Four runtime Skills: `data-analysis` 0.2.0-demo, `data-cleaning` 0.1.0-demo, `feature-engineering` 0.1.0-demo, and `model-training` 0.1.0-demo; release hashes recorded in T13 evidence. The frontend provides a Workbench dashboard, Data Center, Skill Hub, Run Logs, Controlled Plan editing, real-time metrics, and responsive layouts.

## Final Real E2E Trace

Provider/model: `deepseek-official` / `deepseek-flash`. Session `session-f26ae553-a3d1-457a-9dfd-3242fe24f2bc` uses Dataset `ds_cace21337c524db45544fe15`. The Agent loads four Skills, calls Profile and propose. Plan `plan_5ba4262d50d447c4beb3453c77b7e010` has no Run before confirmation. UI changes C to 0.5; revision 2/hash `14a8feb614013ef0a0f9e110b9b5f2dda924506463eb63bbda44131a078f867c`. Human confirmation triggers run `run_f37761f8b8b14eada94fac1b6d8ceedd`.

First Run test set: 240 rows, positive class count = 1, threshold = 0.5; ROC-AUC 0.700152207001522, AP 0.17687589862852446, F1 0, confusion matrix `[[219,0],[21,0]]`. The Agent genuinely calls status/result endpoints and explains that ranking capability differs from fixed-threshold classification; threshold 0.5 failed to identify positive classes in the test set, so tuning thresholds on this specific dataset is invalid. Downloaded metrics artifact SHA-256 matches registered value.

Subsequently, UI changes C to 1.5; revision 3/hash `dd39d49a500b950fee5211e169b5571be1f8bd97a15d6f2bf88ce82d1535306b`. Independent Rerun `run_5754394312ed4c9ea85508e108387642` generated, with `rerun_of` pointing to the first Run. Rerun succeeded; test ROC-AUC 0.7018917155903457, AP 0.18186034786858324, F1 0. Previous run retained in History.

## Testing, Capacity, and Deployment

Final regression: Python 41 PASS, Harness focused tests 42 PASS, TypeScript Host/Client/contracts PASS, lint PASS, `git diff --check` and secrets scan PASS, G1 plus two T13 Run artifact reload/split isolation/metric recalculation PASS. Built-in browser PASS; Playwright Chromium NOT_RUN. Docs gate: 19 PASS / 1 FAIL. The sole failure category involves missing bilingual pairing for internal modeling-demo documentation (28 files total: original 23 + current delivery requirement of 5); rules were not modified nor exemptions added.

Capacity test verified at 1,000,000 × 100 PASS: 403,872,329 B CSV file; full Profile and prepared/manifest export completed in 24.971 seconds total time with peak RSS of 2,865,119,232 B. See [Capacity Report](CAPACITY_REPORT.md). Unified startup, health checks, and shutdown documented in [Deployment Guide](DEPLOYMENT.md); rehearsal takes 8–10 minutes per [Demo Guide](DEMO_GUIDE.md); boundaries defined in [Known Limitations](KNOWN_LIMITATIONS.md).

## Evidence Index

- `docs/modeling-demo/evidence/2026-09-21/t13.json`
- `docs/modeling-demo/evidence/2026-09-21/t13-capacity.json`
- `.artifacts/modeling-demo/t13-cold-start/`
- `.artifacts/modeling-demo/t13-capacity-1m-final/`
- `.artifacts/modeling-demo/t06-harness-home/sessions/--Users-robinzhu-project-dsh-deepseek-harness--/session-f26ae553-a3d1-457a-9dfd-3242fe24f2bc/`

## Final Limitations

The product remains a single-machine demo: limited to logistic regression, fixed pipelines; no Notebook support, Multi-Agent workflows, XGBoost, SHAP, or arbitrary DAGs. OS CPU/memory hard quotas set at P1 level. Existing constraints verified for single concurrency, run/training timeouts, maximum feature counts, and upload limits.
