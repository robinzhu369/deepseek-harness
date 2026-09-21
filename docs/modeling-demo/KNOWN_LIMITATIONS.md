# 智模工作台已知限制

## VERIFIED

- 单 CSV、后台完整 Profile、受限 Preview、固定清洗/特征链路、逻辑回归、人工审批、独立 Python Worker、Run History 与 Artifact 下载已用真实数据验证。
- 单计算任务并发、`max_train_seconds`、`max_run_seconds`、`max_output_features` 与上传上限已存在。
- 1,000,000 × 100 容量测试通过 Profile、清洗、基础特征和 prepared/manifest 导出；完整训练未运行。
- Codex 内置浏览器已验证 1440×900、1366×768、1024×768 与 390×844。

## DEMO-ONLY

- SQLite 与本地文件存储、单 Worker、单机 localhost 部署仅用于 Demo，不是多租户生产部署。
- 当前仅支持逻辑回归和固定 Pipeline，不是任意 DAG。
- Skill 中心是五个业务 Skill 的轻量编辑/发布界面，不是通用 Skill 市场或完整评测平台；“技能自检”只显示配置检查，model-evaluation 才解释机器学习模型结果。
- 生命周期 Fixture 仅用于视觉状态复核，所有业务验收使用 live Session/Run 证据。

## NOT_IMPLEMENTED / P1

- XGBoost、随机森林、SHAP、自动调参、Notebook、多表、数据库输入、Multi-Agent、向量数据库、任意 Python/SQL/Shell、任意网络工具均未实现。
- Notebook 与任意 DAG/分支/循环/并发执行未实现。
- OS 级 CPU/内存硬配额未实现；当前只有应用层单并发与超时/维度/上传限制。
- Playwright Chromium 未安装，自动化为 `NOT_RUN`；内置浏览器验证为 PASS。
- 仓库 docs gate 为 19 PASS / 1 FAIL；唯一失败类别是 28 份内部 modeling-demo 文档缺双语配对。这不影响 runtime、真实 E2E 或容量结果，但会影响仓库文档门禁。
