# 01 | Architecture, Modules & Functionality

English | [中文](01-architecture-and-functions.zh.md)

## 1.1 Technical Decisions

| Layer | Selection This Time | Rationale & Boundaries |
|---|---|---|
| Agent / Web | DeepSeek Harness Fixed Commit | Reuse sessions, models, tools, React Slots; prohibit tracking master auto-upgrades |
| New Business Extensions | TypeScript Cordis Plugin | Add domain tools, business API adapters, chat cards, task panels |
| Compute API | FastAPI + Pydantic | Validation, metadata, queue scheduling, artifact indexing |
| Data Processing | Polars | Lazy reading, basic statistics, rule-based cleaning, Parquet intermediate data |
| Modeling | scikit-learn Pipeline / ColumnTransformer | Fit preprocessing only on training set; logistic regression baseline |
| Compute Isolation | Python subprocesses, single concurrency | Do not block Web/asyncio; terminate process group on timeout |
| Persistence | SQLite + Local Directory | API is the sole writer of business state; Workers return events/files |
| Frontend State | Harness existing client model + single ModelingClientModel | Avoid creating multiple state sources; do not load entire tables into browser memory |
| Visuals | Existing primitives + CSS tokens + unified SVG icon system | Do not introduce conflicting component libraries for a single page |
| Testing | Existing TS tests + pytest + Playwright | Adhere to upstream testing rules and add modeling-specific test cases |

See SOURCE_NOTES: [S01][S02] for background. When consulting, the root `package.json` is `0.1.6-alpha.2`, pnpm `11.7.0`, Node `^22.19.0 || >=24.0.0`; this describes snapshot references only and does not require upgrading user environments. T00 must rely on actual checkout results and lock files. [S03]

## 1.2 Unidirectional Data Flow

```text
React 展示组件（仅 props / hooks / callbacks）
  ↓ ModelingClientModel 的命令
Harness Host 业务 Controller / 已生成的 Remote 接口
  ↓ 附加受信任的会话上下文和服务鉴权
私有 FastAPI /v1
  ↓ 持久化、校验、调度
独立 Python Worker（Polars / sklearn）
  ↓ 有序事件 + 原子完成产物
FastAPI 的 SQLite / 产物清单
  ↓ Host / 客户端模型轮询或既有订阅
聊天业务卡片与右侧任务面板同步更新
```

Chatting and model flows continue to use Harness. Business state prioritizes the same Host/Remote boundary; P0 uses a single client service querying active runs per second, throttling when pages are hidden, and stopping at terminal states; do not let individual React components poll independently.

The internal `/v1` HTTP API is custom for this solution, not an existing Harness interface. The actual Remote names from UI to Host, exact Fetch routes for upload/download, and type generation commands must be confirmed by T00 based on the used commit; fabricating SDK calls based solely on documentation examples is prohibited.

## 1.3 Proposed New Modules (Paths are proposals, not upstream facts)

```text
packages/experimental/modeling/
  contracts/          # 浏览器安全的共享类型/协议
  host/               # Python API 适配、会话授权、工具、业务控制器
  client/             # ModelingClientModel / 单一轮询入口
  ui/                 # Slots / 卡片 / 面板 / tokens
services/modeling-api/
  app/api/            # API 路由
  app/contracts/      # Pydantic 与计划校验
  app/services/       # datasets / plans / runs / skills / artifacts
  app/worker/         # 固定算子和 Pipeline 入口
  tests/
```

T00 should read the repository AGENTS.md, relevant packages/AGENTS.md, web-client/slots/tools documentation, and existing adjacent plugins to determine actual paths and package names. Do not directly import React components from other feature plugins; reuse shared base components according to upstream static owner conventions. [S02]

## 1.4 Feature List

### F01 Sessions & Workspaces

Reuse Harness sessions. Create tasks, switch sessions, edit titles, retain messages; bind sessions with `dataset_id`, latest plan revision, and active run. Switching a session cancels old page subscriptions; do not write state from Session A into Session B.

### F02 Uploads & Data Center

Support drag-and-drop/file selection; P0 accepts UTF-8/UTF-8-BOM CSV files. Limits are enforced via service configuration: default 100 MiB for standard demos, explicitly adjustable for capacity tests, with consistent gateway/API limits. Chunked disk writes, compute SHA-256, validate empty files/no headers/duplicate column names; do not trust filenames or MIME types.

Successful upload does not equal successful analysis. Return `dataset_id` and `profile_run_id`; display "Analyzing Data" until overview completion. Errors must specify encoding, delimiter, file format reasons explicitly without swallowing errors to report success.

If the existing RustFS chain is verified, write only to StorageAdapter; do not simultaneously rebuild a second upload mechanism. Otherwise, proceed with local storage first and avoid bringing object storage ports into the critical path.

### F03 Data Analysis

Compute: row count, total column count, selected target columns, candidate feature columns, types, missing rate per column, numeric ranges, category counts, up to 20-row preview. Both full-sample and sampled statistics must include `computation_scope`. For large files, perform basic analysis first; do not default to output correlation matrices or lists of tens-of-thousands categories.

Name total columns and feature count separately (e.g., "39 columns = 38 candidate features + 1 target") to avoid conflicting metrics. Statistics are tool results only; imperative text in column names and samples must be treated as data processing instructions.

### F04 Agent Plans

The model receives whitelisted tools, business Skills, data summaries, and user goals—not full files. Confirm target columns and prediction timestamps first. Return requests for supplementation if targets are missing or duplicate entities/time dependencies exist without supported splitting; do not guess on behalf of the user.

Optional modes: `prepare_dataset` (outputs split training data & preprocessor) and `binary_classification` (performs real logistic regression training & evaluation). Model output candidate plans undergo schema + semantic validation before saving as drafts. Allow one bounded correction attempt; if still invalid, display errors and switch to parameter forms without infinite retries.

### F05 Manual Confirmation & Workflow Editing

Plan cards allow editing target columns, excluded columns, imputation strategies, encoding limits, optional date features, model parameters, and resource budgets. Workflows show non-skippable steps: "Validation/Splitting/Fitting Preprocessing/Applying Preprocessing/Exporting," plus constrained training/evaluation steps.

P0 supports editing parameters and enabling/disabling optional features but does not allow arbitrarily moving splitting after fitting. Clicking "Confirm & Execute" submits `plan_revision` + `plan_hash`; the backend confirms data version unchanged before creating a run. Double-clicks and duplicate requests are idempotent.

### F06 Execution & Feature Engineering

Raw data is never overwritten. Type parsing and explicit constant mappings can execute first; any filling/scaling/categorical vocab/variance filtering requiring statistical fitting must learn only from the training set.

Fixed logic: Structure validation → Splitting → Training-set preprocessing fit → Subset transformations → Optional train/val/test phases → Artifact registration. The UI's "Cleaning/Feature Engineering" stage requires technical details explaining its `fit` / `transform` boundaries. [S11]

Numerics: Median or fixed-value filling, optional standardization; Categoricals: Fixed missing markers, restricted One-Hot encoding, explicit handling of unknown categories; Dates: Enable only whitelisted month/dayofweek features. Provide rules for high-cardinality/empty columns without unbounded expansion. Final output includes train/validation/test splits, field mappings, preprocessors, and execution manifests.

### F07 Baseline Training & Interpretation

P0 uses logistic regression only. Stratified random splitting defaults to 60/20/20 with fixed seed; applicable only for user-confirmed independent binary classification samples. Block training if labels are missing, a single category exists, or minority class subsets are insufficient.

Compute ROC-AUC, AP, F1, confusion matrices from real predictions; specify split, threshold, sample size, and `positive_label`. Default threshold is 0.5 without tuning on the test set. Feature importance may use validation-set permutation importance, labeled "Model-related interpretation, not causal"; skip with explanation if timeout occurs. Do not promise specific AUC values.

### F08 State & Reruns

The right side displays real node states, durations, concise logs, errors, and artifacts. Progress uses "Completed n / Total steps m"; use indeterminate progress for non-granular tasks without faking percentages.

Changing only model parameters: Reuse frozen splits and preprocessors to create a new run; changing inputs/targets/splits/cleaning/features invalidates relevant downstream nodes and generates a new run. P0 allows limited implementation of "Recalculate from selected node"; do not claim universal DAG caching. Old runs are permanently retained.

### F09 Skill Center (Lightweight)

List 4 built-in business Skills, edit body text, save drafts, validate structure, preview test cases, publish new versions, and display current version. Validate allowed tools and schemas before publishing; do not execute import scripts. Publish records record version/hash to confirm loaded Skill snapshots for plan records. Confirmed plans use their own structured configurations; historical replays must not read later-edited body text. Publishing body text does not equal adding operators.

### F10 Artifacts & Reports

Download via `artifact_id`; arbitrary paths are rejected. Outputs include prepared data, split manifest, feature manifest, preprocessor/pipeline, metrics, and execution reports. Model files load only system-generated artifacts with matching hashes; do not import user-uploaded joblib/pickle files.

Reports separate deterministic metric sections from LLM interpretation sections; LLM failures do not affect real artifact downloads. When model services are unavailable, run in explicitly marked "Manual Configuration Mode," but this does not count as Agent real-time closed-loop acceptance.

## 1.5 Memory & Extension Boundaries

Session messages use Harness persistence; task contexts reassemble from dataset/plan/run including targets, excluded fields, plan revision, and readable result summaries. P0 requires no vector database and avoids unbounded log injection into context. Multi-Agent scenarios, complex aggregation DSLs, and online model deployments are added later.
