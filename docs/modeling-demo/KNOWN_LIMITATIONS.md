# Known Limitations of the Smart Model Workbench

English | [中文](KNOWN_LIMITATIONS.zh.md)

## VERIFIED

- Single CSV, full backend profile, restricted preview, fixed cleaning/feature pipeline, logistic regression, manual approval, independent Python Worker, and Run History with Artifact downloads have been validated using real data.
- Limits exist for single concurrent compute tasks, `max_train_seconds`, `max_run_seconds`, `max_output_features`, and upload caps.
- Capacity testing of 1,000,000 × 100 passed via profile, cleaning, basic features, and prepared/manifest exports; full training was not executed.
- The built-in Codex browser has been verified for resolutions: 1440×900, 1366×768, 1024×768, and 390×844.

## DEMO-ONLY

- SQLite with local file storage, single Worker, and localhost deployment are demo-only configurations; they do not support multi-tenant production deployments.
- Currently supports only logistic regression and fixed pipelines; arbitrary DAGs are not supported.
- The Skill Center is a lightweight editor/publisher for five business skills, not a general skill marketplace or full evaluation platform; "Skill Self-Check" displays configuration checks only, while `model-evaluation` interprets machine learning model results.
- Lifecycle fixtures are used solely for visual state verification; all business acceptance relies on live Session/Run evidence.

## NOT_IMPLEMENTED / P1

- XGBoost, Random Forest, SHAP, auto-hyperparameter tuning, Notebooks, multi-table support, database inputs, Multi-Agent, vector databases, arbitrary Python/SQL/Shell scripts, and arbitrary network tools are not implemented.
- Arbitrary DAGs, branching, loops, and concurrent execution in Notebooks are not implemented.
- OS-level CPU/memory hard quotas are not implemented; current limits apply only at the application layer (single concurrency with timeouts/dimension/upload caps).
- Playwright Chromium is not installed; automation tests are marked `NOT_RUN`; built-in browser verification passed (`PASS`).
- The repository docs gate status: 19 PASS / 1 FAIL. The sole failure category involves missing bilingual pairs in 28 internal modeling-demo documents. This does not affect runtime, real E2E, or capacity results but impacts the repository documentation gate.
