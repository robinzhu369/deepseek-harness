# T13：端到端与 Skill 评测记录

2026-09-16。本轮按用户确认的范围完成合成评测与端到端验证。人工业务标注暂缺，正式 Skill 质量验收和发布门禁保持关闭。

## 结果

| 验证 | 结果 | 证据 |
|---|---|---|
| 实际工作台业务链 | 通过：200 行 CSV → 上传/容器导入 → 分页预览 → 三阶段画布提案/人工审批 → Docker 计算 → 下载训练包/校验和 → 缓存重跑 | [浏览器结果](../evals/data-agent/t13-browser-result.json)、[日志](../evals/data-agent/t13-browser.txt)、[截图](t13-workbench.png) |
| 历史真实模型规划执行回放 | 72 条原始观测，38 个有效 DAG 实际执行通过；候选仍 30/36，基线 28/36 | [执行记录](../evals/data-agent/t13-executed-quality.json) |
| 四个 Skill 合成协议回归 | 72 次新建 Harness 会话通过，含 48 个执行计划；候选与基线均使用确定性模型适配器 | [报告](../evals/data-agent/t13-skill-quality-fixture.json)、[固定预期](../extensions/data-agent/tests/quality.expected.json)、[Profile 日志](../evals/data-agent/t13-quality-profile.txt) |
| Web 组合评测 | 18 次确定性模型会话通过；通用编码提示词/工具隔离；合成发布返回 BUSINESS_EVALUATION_REQUIRED | [浏览器结果](../evals/data-agent/t13-browser-result.json) |
| 扩展整合回归 | 62/62，无跳过；包含权限、审批、候选隔离、取消、重启、缓存完整性和锁定 Skill 恢复 | [日志](../evals/data-agent/t13-extension-tests.txt) |
| Python 引擎与容器隔离 | 31/31，无跳过；包含拟合范围、字段保护、网络/根文件系统/cgroup 约束及凭据隔离 | [日志](../evals/data-agent/t13-python.txt) |
| HTTP 桥接与 Remote 边界 | 10/10 | [日志](../evals/data-agent/t13-http-bridge.txt) |
| 构建及静态检查 | Host 构建、扩展类型检查、全仓 lint、git diff --check 通过 | [构建](../evals/data-agent/t13-host-build.txt)、[类型检查](../evals/data-agent/t13-typecheck.txt)、[lint](../evals/data-agent/t13-lint.txt) |
| 文档检查 | doc-sync 34/34，doc-quick 16/16 | [同步](../evals/data-agent/t13-doc-sync.txt)、[快速检查](../evals/data-agent/t13-doc-quick.txt) |

## 实际修复

1. CSV 显式空字符串标识在数值转换前生效；未声明空值策略时仍保留合法空字符串及前导零。修复由容器导入链路发现，以解析器回归和重建的 Worker 镜像验证。
2. HTTP 共用流式路由的 GET/HEAD 不再附加 Fetch 请求体，下载训练包可到达业务处理器。增加方法级回归，并在真实浏览器下载后验证 ZIP 内各文件 SHA-256。
3. Skill 评测会话替换通用编码提示词、关闭环境上下文，仅暴露结果提交工具。Web 与独立 Profile 均覆盖该约束。
4. 规划评测在 Schema、版本、审批和只读检查之后执行生成的 DAG；独立逐行校验原值、标签、行标识、填充值和派生公式。故意算错的引擎测试确认校验器能拒绝错误。冻结历史流程仍单独计分。

## 评测边界

本轮没有新增公网模型请求。历史真实模型响应来自既有授权的 deepseek-v4-flash 72 次评测；原始报告与 JSONL 不被新结果替换，既有超时、未提交结果和非法输出继续计为失败。新的合成协议测试使用脚本模型，不能证明真实模型质量提升。

合成套件更新为 synthetic-quality-v4 / oracle 6，套件摘要包含留出行、风险请求和执行校验版本。风险请求不再直接告诉模型应返回的状态。旧版留出样本已用于开发回归；新合成样本也只用于工程验证，未冒充人工业务盲测。规划执行使用本地 Python 引擎，完整任务链使用隔离 Docker Worker；二者证据分别保留。

四个 Skill 0.1.1 候选仍未发布。金额成本仍为 null，模型快照未固定，人工标注业务集、审核人及业务通过阈值尚缺。全部产品 AC 与 release_ready 保持 false。T14 容量、T15 内网离线部署以及 T16 产品签收不包含在本轮通过结论中。

## 复现入口

本机测试资源固定于 [t13-test-env.sh](../evals/data-agent/t13-test-env.sh)。两个镜像均以不可变 ID 运行；计算镜像由 [Worker.Dockerfile](../deploy/data-agent/Worker.Dockerfile) 构建，过程记录见 [构建日志](../evals/data-agent/t13-worker-build.txt)。数据库必须是独立的 `_test` 数据库，测试会清空其中的业务数据；不会访问已有业务库。

- Node：加载环境文件后，运行 `npm --prefix extensions/data-agent test`；添加 `DATA_AGENT_QUALITY_EVAL=1` 可在支持 Harness 的 Profile 测试中执行合成对比。
- Python：加载环境文件后，运行 `PYTHONPATH=services/data-worker /opt/homebrew/opt/python@3.10/bin/python3.10 -m pytest services/data-worker/tests -q`。
- 浏览器：加载环境文件，设置测试数据库地址、`DATA_AGENT_T13=1`、`DATA_AGENT_BROWSER_CHANNEL=msedge`、`DSH_SNAPSHOT=replay`，运行 `pnpm exec vitest run --config vitest.web.config.ts extensions/data-agent/tests/workbench-browser.e2e.ts`。
- 历史回放默认只读；仅 `DATA_AGENT_WRITE_EXECUTION=1` 写入本轮执行报告，`DATA_AGENT_WRITE_REPLAY=1` 写入独立重评分报告。

浏览器场景中的工作流是固定测试输入，审批由测试模拟人工点击；模型适配器与这一端到端场景不构成自主业务规划质量证据。测试 dsh、浏览器和计算容器由夹具负责关闭。
