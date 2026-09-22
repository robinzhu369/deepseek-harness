# 智模工作台最终报告

[English](FINAL_REPORT.md) | 中文

## 目标与架构

智模工作台在 DeepSeek Harness 内完成“上传 → Profile → 真实 Agent/Skill 规划 → proposed Plan → UI 修改 → 人工确认 → 独立 Worker → Result/Artifact → Rerun/History”的可演示闭环。实现沿用 Harness Session、Agent、Host/Remote Adapter、React Slots 与插件生命周期；Python Modeling API 负责 SQLite、Dataset、Plan、Run、Artifact 和固定计算 Pipeline。

## 已实现能力

数据上传采用分块写盘、SHA-256 与 Session 隔离；Profile 返回完整扫描聚合与最多 20 行 Preview。Plan 使用 revision/hash、白名单算子/模型参数和乐观并发。LLM 只能读取 Profile、提出 Plan、读取 Run 状态和结果；审批、Shell、Python、SQL 与任意网络工具不对模型可见。人工确认后独立 Python 子进程执行 split-before-fit Pipeline，完成产物才登记。

四个运行时 Skill 为 `data-analysis` 0.2.0-demo、`data-cleaning` 0.1.0-demo、`feature-engineering` 0.1.0-demo、`model-training` 0.1.0-demo；发布 hash 记录在 T13 evidence。前端提供工作台、数据中心、技能中心、运行记录、受控 Plan 编辑、真实指标和响应式布局。

## 最终真实 E2E

Provider/model 为 `deepseek-official` / `deepseek-flash`。Session `session-f26ae553-a3d1-457a-9dfd-3242fe24f2bc` 使用 Dataset `ds_cace21337c524db45544fe15`。Agent 加载四个 Skill，调用 Profile 与 propose；Plan `plan_5ba4262d50d447c4beb3453c77b7e010` 在确认前没有 Run。UI 将 C 改为 0.5，revision 2/hash `14a8feb614013ef0a0f9e110b9b5f2dda924506463eb63bbda44131a078f867c`，人工确认后产生 `run_f37761f8b8b14eada94fac1b6d8ceedd`。

首个 Run 的测试集为 240 行、正类 1、阈值 0.5：ROC-AUC 0.700152207001522、AP 0.17687589862852446、F1 0、混淆矩阵 `[[219,0],[21,0]]`。Agent 真实调用 status/result 并解释：排序能力与固定阈值分类表现不同，0.5 未识别正类，不能在测试集上调阈值。下载的 metrics artifact SHA-256 与登记值一致。

随后 UI 将 C 改为 1.5，revision 3/hash `dd39d49a500b950fee5211e169b5571be1f8bd97a15d6f2bf88ce82d1535306b`，产生独立 Rerun `run_5754394312ed4c9ea85508e108387642`，`rerun_of` 指向首个 Run。Rerun succeeded，测试 ROC-AUC 0.7018917155903457、AP 0.18186034786858324、F1 0，旧 Run 在 History 中保留。

## 测试、容量与部署

最终回归：Python 41 PASS，Harness 聚焦 42 PASS，TypeScript Host/Client/contracts PASS，lint PASS，`git diff --check` 与 secrets scan PASS，G1 与两个 T13 Run 的产物重载/切分隔离/指标复算 PASS。内置浏览器 PASS；Playwright Chromium NOT_RUN。Docs gate 为 19 PASS / 1 FAIL；唯一失败类别是 28 份 modeling-demo 内部文档缺双语配对（原 23 份加本次要求的 5 份交付文档），未修改规则或增加豁免。

容量实测 1,000,000 × 100 PASS：403,872,329 B CSV，完整 Profile 和 prepared/manifest 导出总耗时 24.971 秒，峰值 RSS 2,865,119,232 B。详见 [容量报告](CAPACITY_REPORT.zh.md)。统一启动、健康检查与停止见 [部署指南](DEPLOYMENT.zh.md)，8～10 分钟彩排见 [演示指南](DEMO_GUIDE.zh.md)，边界见 [已知限制](KNOWN_LIMITATIONS.zh.md)。

## Evidence 索引

- `docs/modeling-demo/evidence/2026-09-21/t13.json`
- `docs/modeling-demo/evidence/2026-09-21/t13-capacity.json`
- `.artifacts/modeling-demo/t13-cold-start/`
- `.artifacts/modeling-demo/t13-capacity-1m-final/`
- `.artifacts/modeling-demo/t06-harness-home/sessions/--Users-robinzhu-project-dsh-deepseek-harness--/session-f26ae553-a3d1-457a-9dfd-3242fe24f2bc/`

## 最终限制

产品仍是单机 Demo：仅逻辑回归、固定 Pipeline、无 Notebook/Multi-Agent/XGBoost/SHAP/任意 DAG。OS CPU/内存硬配额为 P1；现有单并发、运行/训练超时、最大特征和上传上限已验证。
