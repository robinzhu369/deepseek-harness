# 06 | Testing and Acceptance

English | [中文](06-tests-and-acceptance.zh.md)

## 6.1 Minimum Business Scenarios

| ID | Scenario | Expected result |
|---|---|---|
| E01 | Upload a valid synthetic CSV | File is stored, hash is stable, Profile matches actual data |
| E02 | Empty CSV / no header / duplicate columns / unsupported encoding | Explicit rejection with no usable fake dataset |
| E03 | Request a complete modeling task in Chat | Real domain tools run and produce a schema-valid candidate plan |
| E04 | No target column selected | Flow waits for input and training cannot start |
| E05 | Model requests execution directly or includes an approve field | Allowlist/schema/authorization rejects it |
| E06 | User confirms twice or the network retries | One idempotent request creates only one run |
| E07 | Plan revision or data hash changed | Return 409 and require confirmation again |
| E08 | Normal run | Node states advance truthfully and emit real files and metrics |
| E09 | Switch Session and refresh | Restore the correct Session without rerun or state leakage |
| E10 | Cancel run or force Worker failure | cancelled/failed; downstream blocked; incomplete files unavailable |
| E11 | Restart service | Previous run becomes interrupted, never falsely resumed or successful |
| E12 | Change model parameters and rerun | New run_id, old result retained, valid reuse has evidence |
| E13 | Change cleaning/feature rules and rerun | Related downstream work invalidates; stale preprocessing is not reused |
| E14 | Publish a new Skill version | New plans use the new snapshot; old plans do not change |
| E15 | Manual mode or LLM failure | Explicitly labeled and not counted as a real-time Agent loop |
| E16 | Access another Session's artifact / path traversal | Reject without file or token disclosure |

## 6.2 Data-Science Correctness Scenarios

Construct controlled data whose training and validation/test sets have different missing-value statistics and verify that imputation values come from training data. Use a Spy/Mock or explicit fitted-row record to prove that fit never observes validation/test rows. The target and record ID do not enter features.

Test unknown One-Hot categories, high cardinality, entirely empty columns, numeric NaN/Inf, insufficient minority classes, and mismatched label type/positive_label. Sets in the split manifest do not overlap and cover all valid samples. Metrics in the report can be recomputed consistently from saved predictions/models and test data.

Apply the same fit-boundary checks to `prepare_dataset`; not training yet does not permit fitting on all data before labeling files as train/validation/test.

## 6.3 Frontend Acceptance

| Check | Standard |
|---|---|
| Primary color | Primary actions and selections use the #0F4C9E family, not default purple |
| Menu | Every expanded item has an icon and Chinese label; selection is clear |
| Buttons | Business buttons have icons; primary actions retain text; icon-only controls have names/tooltips |
| Three columns | Usable at 1440/1366; collapsing the right side does not impair the middle |
| Scrolling | Messages and sidebars scroll independently; no page-wide horizontal overflow |
| Composer | Does not cover the last message; IME Enter does not submit accidentally |
| Metrics | Total columns/features/target remain distinct; sampled statistics are labeled |
| States | Empty, loading, confirmation, running, failed, canceled, and completed states show a next step |
| Keyboard | Tab/Shift+Tab reaches controls, focus is visible, Esc closes dialogs and restores focus |
| Performance | Large tables use previews and pagination; one million rows are not sent to the browser as JSON |
| Truth | Completion is not inferred from LLM text; metrics come from the backend |

Save at least six screenshot categories: workspace-empty, dataset-ready, plan-review, run-running, run-failed, and run-succeeded. Test two desktop viewports. Responsive checks at 1024/390 are lower priority than the live path, but list them when unverified.

Store screenshots under `docs/modeling-demo/evidence/<date>/`. Record browser, viewport, data mode (fixture/live), and run_id when applicable. Do not include credential-bearing URLs or raw sensitive records.

## 6.4 Suggested Test Layout

```text
services/modeling-api/tests/
  test_plan_validation.py
  test_split_and_leakage.py
  test_upload_profile.py
  test_approval_idempotency.py
  test_run_lifecycle.py
  test_artifact_security.py
  test_skill_versions.py
packages/experimental/modeling/tests/ # 实际路径由 T00 确认
  client-state.spec.ts
  modeling-tools.spec.ts
  modeling-ui.spec.tsx
tests/modeling-demo/
  happy-path.spec.ts
  failure-and-refresh.spec.ts
  visual-smoke.spec.ts
```

Follow upstream test and build commands instead of guessing `npm test`. Record actual commands in REPO_DISCOVERY. A missing command is a failure, not a reason to skip silently.

## 6.5 Independent Performance Test

For a one-million-row by one-hundred-column test, record hardware, data types/string cardinality, disk, file bytes, software versions, elapsed time and peak RSS for each step, whether the data is complete, and artifact sizes. Streaming does not mean every operator streams; some operations may fall back to memory. Large-matrix conversion is also memory-limited. [S12]

Do not promise that one million rows finish in seconds or that 8 GB is always sufficient. Report only measured results. Use `SCALE_NOT_RUN` when untested. Reading a complete Profile does not prove that all cleaning, feature, and training paths support the scale.

## 6.6 Completion Report Template

```text
实现：F01/F02/…
真实业务验证：E01 PASS …
模型规划链路：LIVE_PASS / NOT_RUN / FAIL
视觉验证：视口、截图文件、修复内容
规模验证：实际数据规模和报告路径 / SCALE_NOT_RUN
构建与测试：命令、退出码、摘要
未实现/限制：明确列出
启动方式与演示步骤：可复制命令
```

Final acceptance does not require attractive model metrics. It requires real, explainable, reproducible results and must not describe a software Demo as a production risk-control platform.
