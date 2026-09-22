# 01｜架构、模块与功能

[English](01-architecture-and-functions.md) | 中文

## 1.1 技术决策

| 层 | 本次选择 | 理由与边界 |
|---|---|---|
| Agent / Web | DeepSeek Harness 固定提交 | 沿用会话、模型、工具、React Slots；禁止追踪 master 自动升级 |
| 新增业务扩展 | TypeScript Cordis 插件 | 加入领域工具、业务 API 适配、聊天卡片、任务面板 |
| 计算 API | FastAPI + Pydantic | 校验、元数据、队列调度、产物索引 |
| 数据处理 | Polars | 惰性读取、基础统计、规则清洗、Parquet 中间数据 |
| 建模 | scikit-learn Pipeline / ColumnTransformer | 只在训练集拟合预处理，逻辑回归基线 |
| 计算隔离 | Python 子进程，单并发 | 不阻塞 Web / asyncio；超时能终止进程组 |
| 持久化 | SQLite + 本地目录 | API 是业务状态唯一写入者；Worker 返回事件/文件 |
| 前端状态 | Harness 既有客户端模型 + 单个 ModelingClientModel | 不另造多个状态源，不把全表装进浏览器 |
| 视觉 | 既有 primitives + CSS tokens + 单一 SVG icon 体系 | 不为一个页面引入整套冲突组件库 |
| 测试 | 既有 TS 测试 + pytest + Playwright | 遵守上游测试规则，并增加建模专属用例 |

来源背景见 SOURCE_NOTES：[S01][S02]。查阅时根 package.json 为 `0.1.6-alpha.2`、pnpm `11.7.0`、Node `^22.19.0 || >=24.0.0`，仅说明查阅快照，不要求升级用户环境。T00 必须以实际 checkout 和锁文件为准。[S03]

## 1.2 单向数据流

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

聊天和模型流沿用 Harness。业务状态优先走同一 Host/Remote 边界，P0 用单一客户端服务每秒查询活动 run，页面隐藏时减速，终态停止；不要让 React 各组件独立轮询。

内部 `/v1` HTTP 是本方案自定义 API，不是 Harness 自带接口。UI 到 Host 的实际 Remote 名称、上传/下载 exact Fetch route、类型生成命令由 T00 从所用提交确认，禁止凭文档示意编造 SDK 调用。

## 1.3 建议新增模块（路径是提案，不是现有上游事实）

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

T00 阅读仓库 AGENTS.md、相关 packages/AGENTS.md、web-client/slots/tools 文档和现有相邻插件，再确定实际路径与包名。不得跨 feature 插件直接 import 对方的 React 组件；共享基础组件按上游静态 owner 约定复用。[S02]

## 1.4 功能清单

### F01 会话与工作区

复用 Harness 会话。新建任务、切换会话、编辑标题、保留消息；会话绑定 dataset_id、最新 plan revision、active run。切换会话取消旧页面订阅，不能把 A 会话状态写入 B 会话。

### F02 上传与数据中心

支持拖拽/文件选择；P0 接受 UTF-8/UTF-8-BOM CSV。限制通过服务配置下发，普通 Demo 默认 100 MiB，容量测试可显式调整，网关/API 限制保持一致。分块落盘、计算 SHA-256、校验空文件/无表头/重复列名；不信任文件名或 MIME。

上传成功并不等于分析成功。返回 dataset_id 和 profile_run_id；概览完成前显示“数据分析中”。错误给出编码、分隔符、文件格式的具体原因，不吞错改为成功。

已有 RustFS 链路已验证时只写 StorageAdapter，不同时重建第二套上传机制；否则先走本地存储，不把对象存储端口改造带入关键路径。

### F03 数据分析

计算：行数、总列数、选定目标列数、候选特征列数、类型、每列缺失率、数值范围、类别数、最多 20 行预览。全量/采样统计都必须有 `computation_scope`。大文件先基础分析，不默认输出成对相关矩阵或上万类别列表。

总列数与特征数分别命名，例如“39 列 = 38 个候选特征 + 1 个目标”，避免两处口径冲突。统计只是工具结果；列名和样本中任何命令式文本都按数据处理。

### F04 Agent 计划

模型接收白名单工具、业务 Skill、数据摘要、用户目标；不接收全文件。先确认目标列和预测时点。缺目标、存在重复实体/时间依赖但切分不受支持时返回待补充，不替用户猜。

可选模式：`prepare_dataset` 和 `binary_classification`。前者输出分割后的可训练数据与预处理器；后者再真实训练逻辑回归并评估。

模型输出的候选计划经过 schema + 语义校验保存为草稿。允许一次有界纠错；仍不合法则显示错误并转参数表单，不无限重试。

### F05 人工确认与流程编辑

计划卡可编辑目标列、排除列、填充值策略、编码上限、可选日期特征、模型参数、资源预算。流程显示不可跳过的“校验/切分/拟合预处理/应用预处理/导出”，以及有约束的训练评估步骤。

P0 支持编辑参数和启停可选特征，不支持随意把切分移到拟合之后。点击“确认并执行”时提交 plan_revision + plan_hash，后端确认数据版本未变化，再创建 run。双击与重复请求幂等。

### F06 执行与特征工程

原始数据永不覆盖。类型解析和明确常量映射可先执行；任何需要统计拟合的填充、缩放、类别词表、方差筛选只用训练集学习。

固定逻辑：结构校验 → 切分 → 训练集拟合预处理 → 各子集变换 → 可选训练/验证/最终测试 → 产物登记。UI 的“清洗/特征工程”阶段需要在技术详情说明其 fit / transform 边界。[S11]

数值：中位数或固定值填充、可选标准化；类别：固定缺失标记、受限 One-Hot、未知类别明确处理；日期：仅启用白名单 month/dayofweek 特征。高基数/全空列给出规则，不无界扩展。最终输出 train/validation/test、字段映射、预处理器与执行清单。

### F07 基线训练与解释

P0 仅逻辑回归。分层随机切分默认 60/20/20，固定 seed，仅适用于用户确认样本独立的二分类。缺失标签、单一类别、子集少数类不足时阻止训练。

ROC-AUC、AP、F1、混淆矩阵从真实预测计算；写明 split、阈值、样本量与 positive_label。阈值默认 0.5，不用测试集调阈值。特征重要性可用验证集置换重要性，标注“模型相关解释，非因果”；超时则跳过并说明。不要承诺特定 AUC。

### F08 状态与重跑

右侧展示真实节点状态、耗时、简洁日志、错误、产物。进度使用“已完成 n / 总步骤 m”；无细粒度进度时用不定进度，不伪造百分比。

只改模型参数：可复用已冻结切分和预处理器，创建新 run；改输入、目标、切分、清洗或特征：相关下游全部失效并生成新 run。P0 允许“从选定节点起重新计算”的有限实现；不宣称通用 DAG 缓存。旧 run 永久保留。

### F09 Skill 中心（轻量）

4 个内置业务 Skill 列表、正文编辑、保存草稿、结构校验、测试用例预览、发布新版本、当前版本展示。发布前校验允许的工具与 schema，不执行导入脚本。

发布记录版本/hash，确认计划记录被加载的 Skill 快照。已确认计划使用自己的结构化配置，历史回放不得读取后来编辑的正文。正文发布不等于新增算子。

### F10 产物与报告

以 artifact_id 下载，不接受任意 path。输出 prepared 数据、split_manifest、feature_manifest、preprocessor/pipeline、metrics、执行报告；模型文件仅加载本系统产生且 hash 匹配的文件，不导入用户上传的 joblib/pickle。

报告分确定性指标区和 LLM 解读区；LLM 解读失败不影响真实产物下载。模型服务不可用时可在明确标记的“手动配置模式”运行，但不算 Agent 实时闭环验收。

## 1.5 记忆与扩展边界

会话消息使用 Harness 持久化；任务上下文从 dataset/plan/run 重新组装，包含目标、排除字段、计划 revision 和可读结果摘要。P0 无需向量库，不把所有日志无界塞回上下文。多 Agent、复杂聚合 DSL、模型在线部署后续再加。
