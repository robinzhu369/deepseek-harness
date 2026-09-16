# T14：容量验证

2026-09-16。本地固定资源验证完成：百万行 × 100 列主场景两次全链路成功，训练包达到 `ready_for_training_contract` 并逐行对账。宽表及高基数边界失败，不能声明任意百万行百列数据都受支持。AC-43 保持组件证据，目标内网验收及正式发布仍未通过。

## 固定环境与输入

- [环境证据](../evals/data-agent/t14/environment.json)：macOS 24 GiB、10 逻辑核；Docker 10 核、8,321,712,128 字节；单 Worker 限制 4 vCPU、4 GiB，临时 tmpfs 512 MiB、输出 tmpfs 768 MiB、输入 1 GiB，执行期限 240 秒。其他业务容器照常运行；未修改 Docker 全局资源。
- [主场景配置](../evals/data-agent/t14/baseline.json)冻结全部限额、seed=42、采样间隔及判定阈值。镜像使用不可变 SHA-256。该本机配置与需求的 8 vCPU / 32 GiB、Worker 20 GiB 候选服务器不同。
- [生成器](../evals/data-agent/t14/generate.py)生成 1,000,000 行：70 个数值列、27 个中文类别列、实体编号/标签/日期各一列。实体编号保留前导零，每实体两条观测；类别各 5 类、UTF-8 长度 12 字节；日期循环 365 天；数值约 1/31 缺失，约 1/100003 为 -999 异常值，其余数值按固定公式生成。缺失优先于异常值。每列实际计数和输入 SHA-256 写入运行目录的 `input.json`。
- 主输入 Parquet 为 18,588,457 字节。宽表配置为 210 数值列和 87 类别列，共 300 列；长字符串配置只将 c0 改为 256 字节、100,000 类，其他列不变。

## 实际业务路径

真实 dsh Web Profile / Loader / Agent / 领域工具 → 浏览器分片上传 → HTTP 远程 Worker 容器导入 → 100 行预览 → 全量诊断 → x0 显式裁剪至 [0,1001]、类别规范化 → 按实体切分 → 仅训练集拟合中位数、标准化及 One-Hot → 三个分区分别转换 → 全量质量检查 → 浏览器下载 ZIP。审批由浏览器自动化提交并绑定真实提案。固定模型适配器只提交预定义 DAG，本节点未调用公网模型；真实 LLM 规划和人工审批等待均未测量。

[完整复测结果](../evals/data-agent/t14/runs/9df66918-28e8-4eab-bc4b-af2f13f1dc64/result.json)包含 19 个节点的资源采样、Docker 状态和控制请求耗时。[截图](t14-workbench.png)来自实际工作台。训练包为 142,741,467 字节，包含 208 个业务列和额外稳定 row_id。三个分区分别为 600,146 / 199,878 / 199,976 行；实体完全隔离，百万条 row_id 无丢失或重复。独立核对器重新计算训练统计及每个数值/One-Hot 特征，逐行核对标签、实体与所有特征，并验证 ZIP 内文件摘要；日期未做独立语义对账。

## 主场景结果

| 指标 | 复测值 | 判定与口径 |
|---|---:|---|
| 计算累计耗时 | 28.94 秒 | ≤ 1,200 秒；19 节点容器执行，含采样开销 |
| Worker 总耗时 | 47.71 秒 | 包含传输、摘要验证、发布与探针循环 |
| 场景总耗时 | 59.00 秒 | 生成、UI、计算、下载及对账；不含 Profile 启动 |
| 上传 / 下载 | 0.347 / 2.588 秒 | 本机浏览器，不代表跨网带宽 |
| 固定 Harness / 自动审批 | 0.566 / 0.521 秒 | 不代表真实 LLM 或人工等待 |
| 控制请求 P95 | 17.24 毫秒 | 计算负载下 93 个查询和 86 个幂等预览提交，共 179 个成功请求；≤ 2 秒 |
| 幂等提交 P95 | 13.35 毫秒 | 每 500 毫秒提交已存在的预览请求；不测大批新 DAG 提交 |
| 缓存 100 行预览 P95 | 7.62 毫秒 | 已物化报告，30 次读取；≤ 3 秒 |
| Worker 内存峰值 | 2,816,450,560 字节（2.62 GiB） | 成功节点停止前读取 cgroup memory.peak，包含诊断进程 |
| 临时 / 输出磁盘观测峰值 | 0 / 146,227,200 字节 | 0.5 秒采样，文件系统块数；短暂峰值可能遗漏 |
| 主机测试目录观测峰值 | 794,249,749 字节 | 每节点结束后采样；不含最终下载 ZIP，不是全机磁盘峰值 |

首次百万行运行亦成功：计算 29.85 秒、场景 58.46 秒，见 [首次结果](../evals/data-agent/t14/runs/215c65ab-d477-4f7a-a037-3d6623b68c6f/result.json)。两次均完成 19/19 节点。单 Worker、单任务和少量重复不证明并发容量或长期成功率；控制 P95 为领域 HTTP 本地接口测量，不包含浏览器渲染或公网代理。

## 边界与失败原因

| 场景 | 实际结果 | 证据与限制 |
|---|---|---|
| 一万行 × 100 列预检 | 成功 | [结果](../evals/data-agent/t14/runs/27dcbec2-8ac9-4a08-a87b-9f4083227cb2/result.json) |
| 百万行 × 100 列 | 两次成功 | 主容量目标通过；低频异常和缺失计数参与核对 |
| 百万行 × 300 列 | 导入及预览成功，全量 inspect 失败 | [原始结果](../evals/data-agent/t14/runs/aef714c9-22b9-416c-9807-3c3df740adb8/result.json)：Docker OOMKilled=true、exit=137；失败前采样内存仅为下界，不能当作最终峰值 |
| 百万行 × 100 列，c0=256 字节/十万类别 | 前 12 节点成功，fit_onehot 失败，无导出 | [原始结果](../evals/data-agent/t14/runs/db166982-54e9-4f04-a6ea-940a2dc86ff4/result.json)：容器非 OOM，远程仅返回 COMPUTE_FAILED；[独立回归](../evals/data-agent/t14/oracle-tests.txt)确认同一生成规则超过 max_categories=16，抛 DIMENSION_LIMIT；远程具体异常未直接保留 |

[宽表状态复测](../evals/data-agent/t14/runs/e8e90dcb-71a0-410a-8dff-563a4471d234/result.json)再次触发 OOM，并确认持久化 Run/节点均为 failed、artifacts 为空，错误码为 WORKER_RESTARTED。两次宽表实验均失败；十万类别实验一次失败。

4 GiB 下不接受上述宽表工作负载。需要在目标服务器复测内存，或修改诊断执行方式后重新验证。宽表的既定 One-Hot 还会产生 648 个业务列，超过当前 512 列上限；单纯加内存不足以令该完整方案通过。高基数必须先经审批采用明确的类别合并/特征选择策略，或换用经支持和评测的编码方案，不可静默截断类别。

远程 Worker 的容器错误目前被归为 COMPUTE_FAILED，恢复路径可能记录 WORKER_RESTARTED；用户界面尚不能准确区分资源耗尽与确定性策略拒绝。此诊断缺口在目标部署前应修复并回归。边界失败保留原始日志，不作为容量通过。正式 Skill 发布、企业身份、RustFS/S3 和离线恢复仍依赖后续节点。

## 重现与证据维护

使用独立 PostgreSQL 16 测试库（名称必须以 `_test` 结尾）；测试会清空该库的 data_agent 数据。准备当前源代码对应的 Worker 固定镜像、已安装 Edge 和 Python Worker 依赖。在仓库根目录设置 `DATA_AGENT_TEST_DATABASE_URL`、`DATA_AGENT_TEST_PYTHON`、`DATA_AGENT_TEST_IMAGE` 后执行：

```sh
DATA_AGENT_BROWSER_CHANNEL=msedge DATA_AGENT_CAPACITY_CONFIG="$PWD/evals/data-agent/t14/baseline.json" pnpm_config_verify_deps_before_run=false pnpm exec vitest run --config vitest.web.config.ts extensions/data-agent/tests/workbench-browser.e2e.ts
"$DATA_AGENT_TEST_PYTHON" -m pytest -q evals/data-agent/t14/test_capacity.py
```

将配置名改为 `wide.json` 或 `long-cardinality.json` 可复测失败边界；当前这些命令预期返回非零，不能用测试通过状态掩盖容量失败。每次生成独立 `runs/<uuid>/` 原始记录，`latest.json` 仅指向最近一次执行，不代表最近一次通过。临时全量数据、浏览器和 compute 容器由 fixture 清理；保留输入摘要、采样、结果与截图。[固定预期](../evals/data-agent/t14/oracle.expected.json)及损坏但重签摘要的训练包回归，证明对账器能发现语义错误。

## 工程检查与清理

独立对账/拒绝回归 2/2、普通工作台快照回归 1/1、扩展类型检查和全仓 lint 通过；文档快速检查 16/16、文档同步 34/34 通过，git diff --check 无错误。容量主场景与边界的原始通过/失败结果按上表单独保留。临时计算容器及本轮 PostgreSQL 测试容器/卷已清理，未改变其他业务容器；代码未提交或推送。
