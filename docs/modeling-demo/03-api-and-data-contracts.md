# 03｜接口、数据、状态与工具契约

本章定义新增领域协议；不冒充 Harness SDK。机器可校验的计划和事件见 `contracts/`。实现可用 Pydantic 生成模型，但不得另写一套语义不一致的前端结构。

## 3.1 权威数据源

| 对象 | 唯一权威源 | 关键字段 |
|---|---|---|
| 会话/消息 | Harness 原有持久化 | session_id、消息事件 |
| Dataset | Python API 的 SQLite | id、session_id、original_name、sha256、size_bytes、storage_key、state、profile_json |
| Plan | SQLite，不可变 revision | id、revision、dataset_id、dataset_sha256、plan_json、plan_hash、skill_snapshots、state |
| Run | SQLite | id、kind、session_id、plan_id/revision、parent_run_id、status、node_states、revision、error、timestamps |
| Artifact | SQLite + 实际文件 | id、run_id、kind、storage_key、sha256、size_bytes、media_type、completed |
| BusinessEvent | SQLite 顺序日志 | seq、run_id、node_id、type、payload、occurred_at |
| SkillVersion | 受控文件快照与索引 | name、version、content_hash、content、created_at、published_by |

`Run.kind=profile` 可无 Plan，只做上传后的只读概览；`Run.kind=modeling` 必须绑定确认后的 Plan。Job/Run 不拆成两套重复状态机。SQLite 写入由 API 协调，Worker 不持有任意业务写权限。

所有时间在 API 使用 UTC ISO-8601，前端按本地时区显示。对象的 session_id 必须由 Host 的受信上下文注入并检查，不能信任模型工具参数中自行声明的会话归属。

## 3.2 私有 API（FastAPI，不直接对公网发布）

| 方法与路径 | 请求/响应要点 | 触发者 |
|---|---|---|
| GET /v1/health | 服务/版本/Worker 就绪；不返回密钥 | Host/健康检查 |
| GET /v1/capabilities | 允许模式、算子、模型、限制、上传格式 | Host/界面 |
| POST /v1/datasets | 流式 multipart file；返回 dataset_id/profile_run_id | 用户上传，经 Host 转发 |
| GET /v1/datasets | 仅当前会话可访问项，分页 | 数据中心 |
| GET /v1/datasets/{id} | 状态与元数据 | 页面 |
| GET /v1/datasets/{id}/profile | profile + computation_scope | 工具/页面 |
| GET /v1/datasets/{id}/preview?limit=20 | limit ≤100，列分页/裁剪 | 数据抽屉 |
| POST /v1/plans | 候选 plan；返回校验后的 id/revision/hash | Agent 工具/表单 |
| PUT /v1/plans/{id} | 带 base_revision；生成新 revision | 用户编辑 |
| GET /v1/plans/{id}?revision=n | 返回不可变版本 | 页面/重跑 |
| POST /v1/plans/{id}/approve-and-run | revision、plan_hash；Idempotency-Key 必填 | 仅用户确认路径 |
| GET /v1/runs/{id} | 完整最新快照、revision、节点、产物 | 客户端服务轮询 |
| GET /v1/runs/{id}/events?after_seq=n | 有序事件分页；可选增强 | 日志详情 |
| POST /v1/runs/{id}/cancel | 幂等请求取消 | 用户 |
| POST /v1/runs/{id}/rerun | 受校验的改动/计划 revision；返回新 run | 用户 |
| GET /v1/runs/{id}/result | metrics、manifest、warnings、artifact IDs | 工具/结果卡 |
| GET /v1/artifacts/{id}/download | 权限校验 + 文件传输 | 用户 |
| GET /v1/skills | 4 个业务 Skill、发布版本、草稿状态 | Skill 中心 |
| PUT /v1/skills/{name}/draft | 受限 Markdown 正文；不接收任意路径 | 用户 |
| POST /v1/skills/{name}/validate | 结构/工具白名单/schema引用检查 | 用户 |
| POST /v1/skills/{name}/publish | 草稿 hash、预期版本；发布不可变快照 | 用户 |

Host 到 Python 使用本地/内网服务鉴权。浏览器只走 Harness 的认证边界和业务 Controller，不能把共享服务 token 写入 JavaScript。具体 Remote / Upload / Download 映射在 T00/T02 记录到 `REPO_DISCOVERY.md`。

## 3.3 通用错误与幂等

错误体：

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

401/403 鉴权，404 不存在/不可访问，409 版本或状态冲突，413 文件过大，422 计划/字段不合法，429 容量上限，503 服务暂不可用。日志保留 request_id/run_id，但不输出密钥、原始银行数据或任意宿主路径。

`approve-and-run` 在一个事务中校验并登记。幂等键的作用域是用户/会话 + 操作，持久化请求 hash 与响应 run_id。同键同请求返回同 run；同键不同请求 409。运行中的原计划不可原地改写。

## 3.4 计划校验：schema 不足以保证语义正确

`contracts/modeling-plan.schema.json` 限定字段与算法，不接受 `code`、`shell`、`sql` 或未知参数。语义校验还必须覆盖：

- dataset_id 与 hash 相符，字段真实存在；目标不能出现在特征中，排除列不得包含不存在的列。
- train/validation/test 比例和为 1；二分类模式要求目标、positive_label、分层随机切分和至少一个受支持模型。
- 二分类目标最终确有两个非空类别，positive_label 与其值/类型一致；每个切分包含所需类别，否则 422。
- P0 随机切分要求用户明确确认样本独立；已知重复实体/时间依赖时提示改用受支持的数据或等待分组/时间切分能力，不能“确认一下就消除风险”。
- `assumptions.samples_independent` 记录这项数据假设；它不是审批字段，也不能授权执行。候选计划中的 `approved`、`execute` 等未知字段一律拒绝。
- `prepare_dataset` 无标签时用 random 切分；有标签时可用 stratified_random。没有训练也要保留 fit/transform 边界，不能用全量统计生成将来被误用的验证集特征。
- date feature 输入类型可解析；One-Hot 类别数/最终特征维度有上限；资源预算不能超过服务上限。
- Skill hash 和发布版本是审计材料，不是执行授权；审批来自用户动作而非 Skill 正文或模型输出。

模型候选结构见 `contracts/examples/valid-classification-plan.json`。它是示例配置，不是对截图文件的推断。

## 3.5 领域工具：4 个足够

| 工具名 | 参数 | 结果 | 权限 |
|---|---|---|---|
| modeling_get_dataset_profile | dataset_id | 摘要与数据问题、字段信息、computation_scope | 只读 |
| modeling_propose_plan | plan | plan_id、revision、hash、needs_confirmation | 只保存候选计划，不执行 |
| modeling_get_run_status | run_id | 状态、节点、revision、warnings | 只读 |
| modeling_get_run_result | run_id | 真实指标、报告摘要、artifact IDs | 只读 |

session_id/身份/服务 token 不出现在模型可控参数中；从 Harness Tool Context 的实际受信字段取得。T00 未查明该字段前不凭空写 `ctx.sessionId` 等接口。

工具返回包含 `ok`、`data` 或 `error`，严格大小限制。结果摘要默认不超过 12 KiB；大文件/完整日志用 artifact 引用，不无限截断到缺失关键信息。错误不得伪装成文本成功。

工具白名单不包含 `approve`、`execute_arbitrary_code`、`shell`。Harness 已有通用工具需要在业务运行 preset 中禁用或收窄，不能只在 Prompt 里劝模型别用。

## 3.6 状态机与事件

Dataset：`uploaded → profiling → ready | error`。

Plan：`draft → proposed → approved`；编辑产生新 revision，旧 revision 保留；被替代版本标记 superseded。审批时再次校验 hash。

Run：

```text
queued → running → succeeded
  │         ├── failed
  │         ├── cancelling → cancelled
  │         └── interrupted（服务/Worker 意外中止）
  └── cancelled
```

取消存在竞态：先已完成则返回终态；取消标记不能覆盖已有成功产物为另一版本。节点状态允许 pending/running/succeeded/failed/skipped/cancelled/interrupted/blocked。上游失败的下游用 blocked，不写 succeeded。

典型事件：`run.queued`、`run.started`、`node.started`、`node.completed`、`node.failed`、`artifact.created`、`run.completed`、`run.failed`、`run.cancelled`、`run.interrupted`。同一个 run 的 seq 严格递增；客户端仅接受较新的 revision，避免轮询乱序把完成回退到运行中。

## 3.7 执行过程与文件原子性

Worker 输入只有冻结的 plan 路径/JSON、解析后的受控数据路径、工作目录、资源预算。通过参数数组启动进程，禁止字符串拼接 shell。

每个 run 独占目录。输出先写 `.partial`，成功 fsync/关闭后原子替换为正式文件；校验完成后才登记 artifact。部分文件不允许下载。报告生成失败不抹掉已经完成的计算产物，但必须给出警告。

服务重启：遗留 running/cancelling 标记 interrupted；排队任务重新校验可恢复入队。训练不承诺断点续算。浏览器刷新只恢复 UI/状态，不触发重复任务。

## 3.8 产物规范

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

稀疏 One-Hot 不应为了导出把巨大矩阵强行 densify。小 Demo 可按受限密度导出 Parquet；超阈值使用 CSR `.npz` + 特征名 + labels，并在 manifest 写明格式。CSV 作为可选导出，明确 Excel 公式注入防护；不能把稀疏大矩阵展开造成 OOM。[S12]

记录数据 checksum、split seed、原始行标识、训练用行数、特征顺序、预处理版本、Skill snapshot、依赖版本、plan hash。可复现不代表跨平台逐 bit 完全一致。
