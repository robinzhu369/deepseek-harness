# 智模工作台｜Codex 两天 Demo 开发文档

版本 1.0 · 2026-09-20

**基座：DeepSeek Harness；主题：#0F4C9E；交互：会话—对话—任务三栏。**

本合并版包含完整执行规范。开发时建议使用资料包按章节加载，并配合项目 Skills、JSON Schema 和 UI 原型。仅下载本文件不会自动安装 Skills，也不包含可运行的业务系统。

---

# 00｜执行契约与范围

版本：1.0 · 编制日期：2026-09-20 · 执行者：Codex · 目标：约两天完成可真实演示的 Demo。

## 0.1 产品目标

开发一个面向数据分析/建模人员的对话式数据建模工作台，参考用户提供的点金 Model X 截图的信息架构与交互方式，但使用自己的产品名称、品牌色、组件和代码。产品暂名“智模工作台”，可通过配置改名。

最短闭环：上传 CSV → 数据概览 → 对话生成计划 → 用户修改/确认 → 清洗及特征工程 → 可选二分类训练 → 真实结果与产物下载。

核心体验是“左侧会话与导航—中间对话与业务卡片—右侧任务与上下文”。不是宣传官网、通用后台大屏或 Notebook 克隆。

## 0.2 不可改动的约束

- 基座为 `deepseek-ai/deepseek-harness`。保留已有会话、Agent、模型适配、工具、Web 通信和插件生命周期。
- 前端沿用现有 React / Slots / 客户端模型体系；不得另建 Next.js、Vite 应用替代 Harness，不得重写 Agent Loop。
- 品牌主色固定为 `#0F4C9E`。展开菜单使用 icon + 中文文字；所有可操作按钮带 icon，主要业务按钮同时保留文字。紧凑工具按钮可 icon-only，但必须有 Tooltip 和可访问名称。
- 运行时可内网部署。不得自动调用公网 LLM、外部 MCP、在线字体或 CDN；开发工具的联网授权与产品运行时隔离。
- 计算在 Python 完成；LLM 只规划、解释及选择白名单工具。不执行模型自由生成的 Python、SQL、Shell 或动态依赖安装。
- 真实人工确认后才能启动清洗/特征/训练的写任务。模型不得伪造批准，前端“已确认”也不是后端授权依据。
- 任务状态、指标和产物必须由执行器产生。禁止 setTimeout 伪造完成、硬编码 AUC、把离线回放伪装成实时计算。
- 支持项目业务 Skill 自定义和可编辑流程；两天 Demo 做下述有边界的实现，不宣称具备完整任意 DAG 平台。

## 0.3 Demo P0 与后续 P1

| 项目 | P0：两天验收 | P1：后续增强 |
|---|---|---|
| 数据输入 | 单个 CSV，单表宽表；明确编码/大小限制 | XLSX、多表、数据库、断点分片上传优化 |
| 数据准备 | 概览、缺失检查、类型检查、白名单清洗/编码、训练数据输出 | 复杂交易窗口聚合、自动特征搜索 |
| 建模 | 有标签二分类、逻辑回归一条真实训练链路 | 随机森林/XGBoost、调参、模型服务 |
| 流程 | 固定骨架、节点参数编辑、可选特征启停、受约束重跑 | React Flow 任意 DAG、分支/循环/并发 |
| Skill | 4 个业务 Skill；正文编辑、保存草稿、校验、发布快照 | 批量导入、完整评测台、灰度、自动优化 |
| 界面 | 三栏工作区、数据抽屉、Skill 轻量管理面板 | 场景实验室、Notebook、完整资源门户 |
| 存储 | SQLite + 本地文件；已有存储可复用 | PostgreSQL / RustFS 完整产品化 |
| 执行 | 单计算任务并发、独立子进程、超时取消、刷新恢复 | 分布式队列、训练断点恢复、多租户 |

三个交付级别必须单独说明：

1. **界面联调通过**：静态/fixture 组件状态可看，不能当成业务验收。
2. **真实闭环通过**：至少一份合成数据，真实 LLM 规划、人工确认、计算、下载全部完成。
3. **规模验证通过**：指定百万行 × 百列数据上的读取、分析、清洗、基础特征及导出有耗时/峰值内存记录。不能用小样本结果替代，也不能自动推导百万行训练能力。

P0 的主演示数据建议 5,000～50,000 行、10～50 列；实际资源许可时增至 100,000 行。百万行测试是独立容量验证任务，未完成须如实标注，不阻断小数据 Demo，但不能宣称已满足完整首期容量验收。

## 0.4 执行原则

先 T00 检查仓库与环境；先完成不依赖 LLM 的固定计算 Pipeline，再接 Agent，再完善界面。保持每一步都能运行，不要先写大量空页面。

使用约 18 小时任务预算 + 2 小时缓冲，只是估算，不是性能/交付保证。若源码构建、内网模型或环境权限阻塞，记录真实失败并缩减 P1；不得静默换基座或用假结果填补。

## 0.5 Codex 每阶段的输出

每阶段结束写入 `docs/modeling-demo/progress.md`：任务 ID、修改文件、运行命令、退出码、截图/日志路径、剩余问题和下一任务。没有运行过的检查标记 `NOT_RUN`，不能写“已通过”。

允许在范围内连续实现，但不自动 push、发 PR、修改全局权限、安装不明插件或删除用户已有代码。发现根本性架构冲突时记录 DECISIONS 并报告，不擅自重搭系统。

## 0.6 真正的业务边界

本工具是研发 Demo，不承担真实授信/反欺诈决策。所有页面数据和测试均使用合成或已批准的脱敏数据。参考截图中的数字只用于视觉参照，不作为训练数据、性能证据或产品能力承诺。


---

# 01｜架构、模块与功能

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
packages/modeling/
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


---

# 02｜页面设计规范：点金 Model X 对标

## 2.1 视觉定位与参考优先级

定位：银行/企业研发使用的数据建模工作台。清晰、克制、可信、轻量，接近用户截图的三栏信息组织，但不是复制其商标或代码。

优先级：用户明确要求 → 本文 tokens 与交互规范 → 参考截图的结构 → 项目既有组件约定 → 外部前端 Skill 的通用建议。外部 Skill 不得把它改成紫色渐变官网、深色科技大屏或巨大 Hero 页面。

参考文件：`reference/modelx-reference.png`。它是用户提供的静态参考，只验证可见布局，不证明 Model X 的内部实现。`ui/modeling-workspace-preview.html` 为本包附带的布局参考，全部示例状态明确标识，不是已实现的 Agent。

## 2.2 色彩与基础 tokens

| Token | 数值 | 用途 |
|---|---|---|
| brand / primary | `#0F4C9E` | 主按钮、选中项、焦点、关键链接 |
| brand-hover | `#0B3D80` | 主按钮悬停 |
| brand-active | `#083269` | 按压 |
| brand-soft | `#EAF1FB` | 选中导航、浅色消息背景 |
| app-bg | `#F5F7FB` | 工作区背景 |
| surface | `#FFFFFF` | 内容面板 |
| sidebar-bg | `#F8FAFD` | 左侧导航 |
| text | `#172B4D` | 正文 |
| text-secondary | `#596B82` | 说明文字 |
| text-muted | `#6B7C93` | 辅助信息；小字号须验对比度 |
| border | `#E2E8F0` | 分隔线/卡片边界，不代替焦点样式 |
| success | `#147D58` | 成功 icon + 文字 |
| warning | `#9A6700` | 待确认/警告 icon + 文字 |
| danger | `#B42318` | 失败/停止 icon + 文字 |

tokens 源文件为 `ui/design-tokens.css`，实现时导入或映射到项目现有主题，不全局覆盖上游变量。正文普通文本对比度目标 ≥4.5:1，交互焦点和非文本状态按适用无障碍规范核验，不能因品牌色好看就省略检查。[S13][S14]

字体使用系统字体栈：`-apple-system, BlinkMacSystemFont, "Segoe UI", "PingFang SC", "Microsoft YaHei", sans-serif`。禁止远程字体和把字体文件打包进本资料。

字号：主标题 20/28，区域标题 16/24，正文/菜单 14/22，表格和辅助信息 12/18（关键错误与字段标签不缩成 10px）。数字可用 tabular-nums。

间距：4/8/12/16/20/24/32px。圆角：按钮 8、卡片 12、输入框 14；不要所有层都套巨大圆角和阴影。卡片以细边框为主，阴影只用于浮层。

## 2.3 三栏布局

目标视口：1440×900，兼顾 1366×768 和 1920×1080。

```text
┌────── 左侧 248 ──────┬────────── 中间 min 480，自适应 ────────┬── 右侧 320 ──┐
│ 图标 智模工作台      │ 当前任务标题             [导出][更多] │ 任务监控 [收起]│
│ [＋ 新建任务]        ├───────────────────────────────────────┤ 任务 / 上下文 │
│ icon 建模工作区      │ 数据概览卡：文件、样本、字段、格式      │ 计划版本 v1   │
│ icon 数据中心        │ 可用技能 / 目标列 / 数据预览入口       │ 节点时间线    │
│ icon 技能中心        │                                       │ 错误或待确认  │
│ icon 运行记录        │ 用户消息                              │               │
│─────────────────────│ Agent 简述 + 可折叠工具执行摘要        │ 当前数据集    │
│ 搜索历史会话         │ 计划卡 / 参数编辑 / 确认按钮           │ 目标与排除列  │
│ 今天 / 昨天 / 更早   │ 结果卡 / 指标 / 产物                   │ 产物快捷入口  │
│ 会话行 ···           │                                       │               │
│                     ├───────────────────────────────────────┤               │
│ 头像 本地演示  设置  │ 输入框：附件 chip / Skill / [发送 icon]│               │
└─────────────────────┴───────────────────────────────────────┴───────────────┘
```

整个应用使用 `height:100dvh; overflow:hidden`，三栏 `min-width:0; min-height:0`。会话列表、中间消息区、右侧任务内容各自滚动。中栏使用 `grid-template-rows:56px minmax(0,1fr) auto`；输入区是布局中的最后一行，不绝对覆盖消息。最后一条消息必须完整可见。

≥1280：248 / minmax(480,1fr) / 320。1024～1279：左栏 216，右侧默认收起为抽屉。768～1023：左栏可折叠 72，但展开仍 icon+文字；移动端 <768：两侧抽屉、中间单栏，不把三栏挤成不可读的小字。

中间对话内容宽度最多 920px，左右 padding 24px；小屏 16px。表格/代码块内部横向滚动，页面本身不得出现水平滚动。

## 2.4 菜单和 icon 规范

沿用仓库已有 SVG icon/primitives；不足时通过一个统一 Icon 适配层补齐。可以选 Lucide 作为新增来源，但必须先确认依赖与许可证，不假定已安装。禁止混用 emoji、文字 Unicode 图标和多个不同风格图标库。

| 导航 | 图标语义（实现名以实际库为准） | 行为 |
|---|---|---|
| 新建任务 | Plus | 创建 Harness 会话，进入空状态 |
| 建模工作区 | Panels / LayoutDashboard | 返回当前三栏工作区 |
| 数据中心 | Database | 中栏或抽屉显示数据集列表 |
| 技能中心 | Wrench / Wand | 打开 4 个业务 Skill 的轻量管理 |
| 运行记录 | History / Clock | 查看真实 run，打开结果 |
| 设置 | Settings | 复用现有设置，不暴露密钥正文 |

菜单高度 40px，icon 18px、描边约 1.75～2px、icon 与文字间距 10px。选中项浅蓝背景、蓝色文字，可加左侧 3px 指示；hover 用轻灰，不能仅靠颜色区分选中。

不实现的 Notebook/场景实验室默认不展示。确需展示时禁用并明确“后续提供”，不得空链接或点击无响应。

## 2.5 按钮规范

全部业务按钮必须有 icon。主要按钮 `icon + 文字`；发送、附件、收起、更多、复制等紧凑操作使用 icon-only。

| 类型 | 样式 | 示例 |
|---|---|---|
| Primary | 蓝底白字，36px 高，8px 圆角 | Play + 确认并执行 |
| Secondary | 白底细边框，深色文字 | Pencil + 修改计划 |
| Tertiary | 透明底、悬停轻底色 | Eye + 查看数据 |
| Danger | 浅红或红字，明确确认 | Square + 停止任务 |
| Icon-only | 32×32 桌面点击区，icon 16～18；触屏适当放大 | Send / Download / More |

禁止重要“发布 Skill”“确认执行”“删除数据”只剩无说明 icon。icon-only 必须 `aria-label` + Tooltip；原生 button 支持 Enter/Space。禁用按钮给出原因；loading 不改宽度、不重复触发。[S13]

交互反馈：hover/focus/pressed/disabled/loading 均定义。焦点使用可见蓝色 outline，不移除 outline。删除和停止不是红色“主要CTA”。

## 2.6 关键组件

### A. DatasetOverviewCard

文件 icon、文件名、状态、样本数、总列数、目标/特征数、大小/格式、预览按钮。数据来自服务端 Profile。未分析显示 skeleton；失败显示具体原因和重试。

仅展示 4～6 个关键数字，不再堆一个“指标仪表盘”。高基数警告与目标待选择可用清晰提示行。

### B. AgentMessage / ToolExecutionBlock

用户消息右对齐、浅蓝底；Agent 消息左对齐、无巨大边框。工具执行摘要默认折叠：工具名、开始/结束状态、耗时、可读结论；展开看参数摘要与脱敏日志。区域名使用“执行说明”，不展示模型隐藏推理。

Markdown 关闭原始 HTML 或经过可靠清洗；代码按文本渲染，外链遵守运行时访问策略。不要让模型输出注入页面脚本或伪造按钮。

### C. ModelingPlanCard

标题“建模方案”，revision/待确认状态；目标列与任务类型；可折叠参数表；有限步骤列表。底部：Pencil 修改计划、Play 确认并执行。

确认按钮在 profile 未就绪、目标未选、schema 错误、数据版本冲突、已有冲突运行时禁用并显示原因。执行后的计划卡只读；改动创建新 revision，不在原卡悄悄变更。

### D. TaskMonitor / NodeRow

右侧“任务 / 上下文”Tab。任务列表显示 status icon + 节点名 + 耗时，点击打开详情。当前步骤可用细蓝边，不需要高饱和整卡闪烁。

状态文案：等待中 / 运行中 / 待确认 / 已完成 / 失败 / 已取消 / 已中断 / 已跳过。失败显示原因和有界重试；不把被跳过步骤算作真正完成。

### E. ResultCard

数据准备模式：输出样本/特征数、数据拆分、处理规则、下载。训练模式加真实评估指标、验证/测试区分、阈值和样本量。

指标还未计算显示“— / 尚未计算”，不得放 0.92 占位。置信区间未实现不编造。报告、数据、模型各有 icon + 文字入口。过多产物折叠成列表。

### F. Composer

支持多行文本；IME 输入时 Enter 不误发；Enter 发送、Shift+Enter 换行，支持手动切换习惯。文件 chip 包含移除按钮。执行中仍可阅读与询问状态，但禁止相同计划重复启动。

底部展示当前数据集与选定 Skill；发送按钮为蓝色圆角方形 icon-only，空输入禁用。附加文件、展开 Skill 使用统一 icon，不能成为无可访问名称的 div。

### G. DatasetDrawer / SkillPanel

数据抽屉：列信息、20 行预览，列多时内部滚动。Skill 面板：列表 → 正文编辑 → 校验结果 → 发布新版本；文本编辑器可先用 textarea，不强行引入 Monaco。

## 2.7 必须设计的状态

空工作区、上传中、数据分析失败、数据就绪、等待人工确认、执行中、任务失败、用户取消、断线重连、执行完成、无 LLM/手动模式。每个状态至少写清入口、页面反馈、可操作项、下一步。

空状态文案：“上传一份 CSV，开始分析与建模。”主操作“上传数据”，次操作“使用演示数据”。不加营销大标题或无关插画。

错误文案采用“问题 + 原因 + 下一步”，例如“无法训练：目标列只包含一种类别。请选择含正负样本的数据或只执行数据准备。”

## 2.8 前端实现与复核循环

调用项目 `$modelx-frontend-design`；外部 `frontend-design` 仅作为辅助。先完成 tokens 与三栏骨架，再补卡片和状态；不同时调用多套互相冲突的审美 Skill。

第一轮：1440×900，检查结构/留白/主色/控件。第二轮：1366×768，检查首屏密度、输入区和滚动。第三轮：1024×768 + 390×844，检查抽屉、按钮命名和溢出。

用真实浏览器截图逐轮比较，保存 evidence 目录。不能只看 JSX 就宣称页面验收通过；没有浏览器能力就明确 `VISUAL_NOT_RUN`。前端 bug 修复必须再次截图，不以旧截图证明新代码。


---

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


---

# 04｜开发任务、依赖与执行顺序

## 4.1 唯一主线

```text
T00 → T01 → T02 → T03 → T04 → T05 → T06   第一天：真实计算与 Agent 连接
                         ↓
T07 → T08 → T09 → T10 → T11 → T12 → T13   第二天：工作台、验收与交付
```

图中的 T07 可以在 T02 后、接口冻结时与后端并行，但单人默认按表顺序执行。不要把多个 Codex 会话同时指向同一工作树写同一组件/锁文件。

## 4.2 任务表

以下时间为实施估算，累计约 18 小时，另预留约 2 小时缓冲。依赖安装、源码构建或模型不可用会改变工期。

| ID | 任务 | 分钟 | 前置 | 验收门槛 |
|---|---|---:|---|---|
| T00 | 仓库与环境探测 | 60 | 无 | 确认上游提交、真实扩展点、模型/构建/测试能力；工具 smoke 成功 |
| T01 | 开发 Skills 与浏览器工具准备 | 30 | T00 | 项目 Skills 可发现；浏览器能力可用或明确阻塞 |
| T02 | 协议、类型与状态模型 | 60 | T00 | 计划/事件 schema、Pydantic 和 TS 契约一致；非法计划测试通过 |
| T03 | 固定 Python Pipeline | 150 | T02 | 不依赖 LLM 完成真实清洗、特征、逻辑回归及产物 |
| T04 | 上传与 Profile | 60 | T02 | 流式上传、hash、数据概览、预览、非法 CSV 拒绝 |
| T05 | 任务执行、审批与持久化 | 90 | T03, T04 | 确认幂等、子进程、超时取消、刷新恢复、产物索引 |
| T06 | Harness 领域工具与 Agent 计划 | 75 | T05 | 四个工具、Skill 快照、真实 LLM 候选计划和人工确认闭环 |
| T07 | 主题与三栏骨架 | 75 | T01, T02 | #0F4C9E、icon 导航/按钮、独立滚动、组件状态演示 |
| T08 | 业务卡片与任务面板联调 | 105 | T06, T07 | 上传、计划、确认、运行、真实结果/下载在三栏联动 |
| T09 | 业务 Skill 轻量管理 | 45 | T06, T08 | 4 个 Skill 可编辑草稿、校验、发布快照；新旧版本隔离 |
| T10 | 有界流程编辑与重跑 | 60 | T08 | 修改参数/启停可选特征，正确失效下游，创建新 run |
| T11 | 端到端与安全回归 | 75 | T09, T10 | 核心 E2E、拒绝未确认、错误/取消/重启、未授权访问检查 |
| T12 | 视觉截图复核与修复 | 45 | T11 | 关键分辨率/状态截图，无溢出遮挡；icon 名称和焦点通过 |
| T13 | 部署、复验与演示交付 | 45 | T12 | 启动文档、固定依赖、真实演示记录和未完成项清单 |

## 4.3 每个任务的交付与停靠点

### T00：不跳过的接手检查

运行 `git status --short`、`git rev-parse HEAD`；读取适用的 AGENTS/override、package.json、lockfile、上游架构和相关插件。确认真实的构建、启动、类型检查与测试命令。

输出 `REPO_DISCOVERY.md`：主/子包目录、工具注册示例、session 上下文字段、Slot/聊天节点示例、业务 Remote/上传下载方式、图标系统、Python/浏览器/模型连通性。首次探测用最小工具调用，不直接改 UI。

存在用户未提交改动必须保留；仅记录影响范围，不 reset/clean。需要升级依赖、换框架、改变数据库或网络策略时不得自行决定。

### T01：只安装最少开发辅助

启用本包 6 个项目 Skill。优先现有浏览器能力或 Playwright CLI；外部 frontend-design / React review 按需调用。未授权网络不可自动下载。安装源码与依赖分开审查，不执行未知 curl | sh。

### T02：先做失败用例

从 contracts 建立类型，写字段不存在、目标泄漏、比例错误、未知算子、未确认写任务和版本冲突测试。冻结接口后才分配 UI 任务。确认并执行不是 LLM tool。

### T03：先拿到真实文件

使用固定种子生成一份小型合成二分类 CSV（代码生成，不联网找数据），包含数值、类别、少量缺失、唯一记录 ID。实现预处理与逻辑回归 Pipeline，输出 metrics 和数据/模型。测试预测可读、feature names 对齐、fit 只看到训练集。

### T04：上传不是读到内存

分块保存并校验路径，生成 dataset id/checksum；分析任务由 Worker 处理。支持空文件、重复列名、格式错误的清晰反馈。Profile 不能把百万行变成 LLM 上下文。

### T05：让状态可追溯

业务数据库记录排队/运行/终态；Worker 输出事件；取消终止进程组，产物原子完成；服务重启标记 interrupted。加入幂等键、计划版本和 session 授权检查。不要做只有内存变量的伪任务系统。

### T06：只接已验证计算服务

添加 4 个领域工具及工具结果解析；加载 4 个运行时业务 Skill；输出候选 plan 卡。使用真实模型验证一条 tool→plan→用户确认→run 链路；模型失败时展示失败，不静默使用固定计划冒充。

### T07：先做可审阅的界面

使用 UI 文档和参考 HTML，先 tokens、导航、三栏、Composer、空状态。fixture 分离且显示“界面演示数据”。复用上游组件系统，禁止另建应用。截图检查 1440 与 1366。

### T08：一次接通完整纵向流程

依次替换 fixture 为真实 API；数据卡、计划卡、任务状态、结果都读同一个 ModelingClientModel。确认双击、切换会话、刷新和轮询乱序不产生双任务/错会话。结果数值来自 metrics.json。

### T09：自定义 Skill 的最小可见交付

列表与 textarea 编辑器、保存草稿、校验、发布版本。发布运行一次 schema smoke；不要把完整 Skill 评测平台放进这 45 分钟。实际实现超时可保留文件编辑 + 发布按钮最小路径，但必须在交付清单列出界面不足。

### T10：参数编辑不是任意 DAG

UI 只暴露能力列表中的合法参数；约束切分必须在拟合之前。模型参数变更创建新 run，复用对象以 hash 确认；清洗/特征变更使其下游重新执行。没有有效缓存则重新计算，不冒充复用。

### T11：证据先于“完成”

运行核心测试；在真实服务上从上传到下载一次。取消、错误、重启、未授权访问独立测试。对改动范围执行上游规定检查；全仓检查未跑写明，不擅自修改上游规范来通过。

### T12：截图→问题→修复→新截图

先修遮挡/溢出/布局，再修 icon/文案/间距。保留修复后的截图与视口；对照参考结构与蓝色主题，不要求像素复制原品牌。

### T13：最后只修阻塞项

记录可复现启动命令、模型配置入口、演示数据种子、软件版本、实际测试、未支持能力。运行容量测试须单独留耗时/内存报告；未跑则 NOT_RUN。禁止最后一小时新增完整 DAG、Notebook 或多 Agent。

## 4.4 阶段 Gate

G0：上游能启动 + 自定义工具 smoke 成功。未过不得开始大规模 UI 改造。

G1：不依赖 LLM 的计算链路真实完成并导出文件。未过不得用硬编码结果填页面。

G2：真实 Agent 候选计划 + 人工确认 + 独立执行。未过不得称为 Agent 闭环。

G3：三栏 UI 全流程、刷新恢复、关键异常、至少两种桌面视口截图通过。

G4：可复验交付；已实现、仅界面、未实现明确区分。

## 4.5 可删与不可删

优先删：第二模型、复杂图表、SHAP、任意 DAG、在线 Notebook、Skill 商店、动画。

不可删：真实计算、目标/切分正确性、确认权限、计划版本、任务真实状态、文件下载、#0F4C9E 主题、可用三栏界面、最低测试证据。


---

# 05｜Codex Skills、前端工具与接入

## 5.1 两套 Skill 不能混用

**开发期 Skill** 指导 Codex 如何读仓库、写页面、实现接口、测试。放在开发仓库 `.agents/skills/modelx-*/SKILL.md`。

**运行期 Skill** 指导数据建模 Agent 如何分析、清洗、特征和训练。模板放在本包 `runtime-skills/`，实施时发布到专用运行时目录 `.dsh/skills/` 或受控 SkillProvider。

Harness 也可能扫描 `.agents/skills`；因此仅靠命名和目录区分不构成隔离。运行时必须不挂载开发 `.agents`，使用无开发仓库的专用 workspace/home，或替换为仅允许 4 个业务 Skill 的 Provider；测试可见 Skill 列表，确认开发 Skill 不可见。[S04]

## 5.2 本包直接可用的 6 个项目 Skill

| 名称 | 调用场景 | 工作产物 |
|---|---|---|
| `$modelx-demo-orchestrator` | 启动开发、继续未完成阶段 | T00～T13 执行、progress 更新、Gate 检查 |
| `$modelx-harness-extension` | 新增工具、Remote、卡片/Slots、上下文 | 不改内核的兼容扩展与测试 |
| `$modelx-frontend-design` | 三栏页面、卡片、icon、主题与优化 | 符合 #0F4C9E 规范的页面与截图 |
| `$modelx-data-pipeline` | CSV、清洗、特征、训练、状态 | 防泄漏 Pipeline、白名单计划与真实产物 |
| `$modelx-skill-authoring` | 业务 Skill 修改/校验/发布 | 不可变版本、最小评测与边界检查 |
| `$modelx-demo-qa` | E2E、异常、安全、视觉验收 | 命令/退出码/截图与真实交付清单 |

这是针对本项目新编写的本地 Skill，不是声称 Codex 内置同名能力。执行 `install.py` 后，CLI/IDE 可用 `/skills` 检查、以 `$skill-name` 显式引用；未发现时重启 Codex。当前官方文档仍支持项目 `.agents/skills`。[S05]

无需一次把六个全文塞入 Prompt；入口 Skill 决定当前阶段，按需加载专业 Skill 与对应章节。

## 5.3 建议使用的外部工具：少而精

| 工具/Skill | 建议 | 用途及限制 |
|---|---|---|
| Anthropic `frontend-design` | 可选设计辅助 | 设计 tokens、布局和审美复核；用户主题/企业界面规范优先 |
| OpenAI `build-web-apps` 中的 `react-best-practices` | 可选代码复核 | 检查 React 组件与性能，不迁移成 Next.js |
| OpenAI `frontend-testing-debugging` | 已安装且工具可用时调用 | 浏览器调试辅助；最终还要留可复验测试 |
| Playwright CLI + Skills | 推荐浏览器方案 | 操作本地页面、截图、查看状态；自动化回归另写测试 |
| Playwright MCP | 备选，已有则复用 | 适合持续浏览器上下文，不必与 CLI 同时安装 |
| Vercel `web-design-guidelines` | 可选审阅 | 可访问性/交互检查；原文要求联网取规则，内网改用批准快照 |
| `$skill-creator` | 创建新 Skill 时按实际可用性调用 | 不为两天 Demo 增设复杂 Skill 生成系统 |

不为了“工具齐全”安装十几个 Skill。没有 Figma 稿，不需要先接 Figma；没有必须查询的第三方文档，不需要先接 Context7。整个产品不得依赖这些开发期外部服务在线运行。

### 重要版本变化

查阅时 `openai/skills` README 已标记 deprecated，指向 `openai/plugins`。因此不把旧仓库中的 curated 路径写成永久有效安装方式；项目本地 Skill 仍可直接使用。[S06][S07]

当前 `openai/plugins` 的 `build-web-apps` 包包含 frontend-app-builder、frontend-testing-debugging、react-best-practices 等。`frontend-app-builder` 侧重完整视觉概念，含图像生成/浏览器等前置要求；本项目默认已有截图和 tokens，优先本地专用 Skill，不让额外设计生成流程阻塞两天实施。[S08]

## 5.4 接入命令

先在用户自己的开发终端检查，不在产品运行时执行：

```bash
codex --version
codex --help
codex plugin --help
codex mcp --help
```

`codex plugin` 在旧版本可能不存在；那就使用本包本地 Skill，不把升级 Codex 作为业务开发前置。禁止自动切换到危险权限或关闭审批。

### 项目 Skill：无需外部下载

在解压目录运行：

```bash
python3 install.py --repo /absolute/path/to/deepseek-harness
# 上一条只预览；确认后执行：
python3 install.py --repo /absolute/path/to/deepseek-harness --apply --merge-agents
```

安装器默认不覆盖已有不同内容，不更改网络/模型配置；`--merge-agents` 仅在根 AGENTS.md 尾部追加短索引并备份，不替换上游规范。存在 AGENTS.override.md 时以适用规则为准，入口 Prompt 显式要求阅读本包。

### Playwright CLI：开发机联网且批准后

按 Microsoft 官方方式安装并检查帮助：[S09]

```bash
npm install -g @playwright/cli@latest
playwright-cli --help
playwright-cli install --skills
```

这是首次联网准备示例，不是可重复部署锁定命令。确认可用后记录解析出的确切版本，预装浏览器及依赖，内网使用固定版本/缓存；不能让 runtime 再访问 npm。检查 install 生成的文件，不能覆盖已有 Skill。

Codex 指令示例：

```text
使用 playwright-cli 检查本地智模工作台。
先读取 playwright-cli --help，不猜测命令。
验证上传→计划→确认→运行→下载，保存 1440×900 和 1366×768 截图。
截图是视觉证据，测试结果需要实际动作与断言；不要只截图就宣布通过。
```

### 已有 MCP 工作流时

```bash
codex mcp add playwright -- npx -y @playwright/mcp@latest
codex mcp list
```

命令结构依据 Codex MCP 文档，组件依据 Microsoft Playwright MCP。仍需固定测试版本、使用独立浏览器配置、限制访问本地批准地址。[S09][S10]

### 可选外部 Skill

在 Codex 输入，而不是在 shell 执行 `$skill-installer`：

```text
$skill-installer
从 anthropics/skills 仓库的 skills/frontend-design 安装 frontend-design。
先核对路径、完整 SKILL.md、引用文件和许可证；不覆盖已存在版本。
若无法访问网络，记录未安装，继续使用本项目 modelx-frontend-design。
```

新版插件入口先发现再安装，不猜 marketplace 名：

```bash
codex plugin marketplace list --json
codex plugin list --available --json
# 若官方源未配置且联网已批准，可执行：
codex plugin marketplace add openai/plugins
codex plugin list --available --json
# 从返回结果选取实际 marketplaceName，随后：
# codex plugin add build-web-apps@<实际marketplaceName>
```

上面的 `<实际marketplaceName>` 必须用发现结果替换，不是可原样运行的命令。安装会改变本机 Codex 能力，需用户审阅，不由产品服务执行。[S15]

## 5.5 不同阶段的组合

T00/T06：modelx-harness-extension + 上游仓库文档。

T03/T05：modelx-data-pipeline + pytest。

T07/T08：modelx-frontend-design；需要创意校准时再读 frontend-design；实现必须沿用 repo。

T11/T12：modelx-demo-qa + Playwright；可选 React / web-design-guidelines 复核。无网络时按本文离线检查表，不伪称检查了线上最新规则。

工具不可用的失败必须可见。没有截图工具时写 VISUAL_NOT_RUN，不生成一张概念图充当浏览器实测截图。


---

# 06｜测试与验收

## 6.1 最低业务用例

| ID | 用例 | 预期 |
|---|---|---|
| E01 | 上传合法合成 CSV | 文件落盘，hash 稳定，Profile 与实际数据一致 |
| E02 | 空 CSV / 无表头 / 重复列名 / 非支持编码 | 明确拒绝，不产生可用假数据集 |
| E03 | 对话提出完整建模请求 | 真实调用领域工具，产生 schema 合法候选计划 |
| E04 | 没有选择目标列 | 停在待补充，训练不可启动 |
| E05 | 模型直接请求执行或夹带 approve 字段 | 被白名单/schema/权限拒绝 |
| E06 | 用户确认计划两次/网络重试 | 同一幂等请求只创建一个 run |
| E07 | 计划 revision 或数据 hash 已变化 | 409，用户需重新确认 |
| E08 | 正常运行 | 节点状态真实推进，输出真实文件和指标 |
| E09 | 切换会话与刷新 | 正确恢复当前会话，不重新执行、不串状态 |
| E10 | 取消运行/强制 Worker 失败 | cancelled/failed；下游 blocked，未完成文件不可下载 |
| E11 | 服务重启 | 原运行标记 interrupted，不假称续训/成功 |
| E12 | 修改模型参数重跑 | 新 run_id，旧结果保留，合法复用有证据 |
| E13 | 修改清洗/特征规则重跑 | 相关下游失效，不复用错误的预处理结果 |
| E14 | 发布 Skill 新版本 | 新计划使用新快照，旧计划不变化 |
| E15 | 手工配置模式/LLM 失败 | 明确标记，不被算作 Agent 实时闭环 |
| E16 | 访问另一会话 artifact / path traversal | 拒绝，无文件或 token 泄露 |

## 6.2 数据科学正确性用例

构造训练集与验证/测试集具有不同缺失统计值的可控数据，验证填充值来自训练集。Spy/Mock 或显式拟合行记录验证 fit 从未看到验证/测试行。目标和记录 ID 不进入特征。

测试 One-Hot 未知类别、高基数、全空列、数值 NaN/Inf、少数类不足、标签类型/positive_label 不匹配。Split manifest 中各集合不重叠且覆盖合法样本。报告中的指标能够由保存的预测/模型与测试数据重新计算一致。

对 prepare_dataset 路径同样检查拟合边界；禁止因为“暂不训练”就全量拟合后再把文件标记为训练/验证/测试。

## 6.3 前端验收

| 检查 | 标准 |
|---|---|
| 主色 | 主要操作、选中项均为 #0F4C9E 系列，非默认紫色 |
| 菜单 | 展开态每项 icon + 中文标签；选中态明确 |
| 按钮 | 业务按钮带 icon；主要操作保留文字；icon-only 有名称/提示 |
| 三栏 | 1440/1366 可用，右侧收起不影响中间 |
| 滚动 | 消息/侧栏分别滚动，无全页水平溢出 |
| 输入框 | 不覆盖最后消息，IME Enter 不误发 |
| 信息口径 | 总列/特征/目标分开；采样统计标识可见 |
| 状态 | 空、载入、确认、运行、失败、取消、完成均有下一步 |
| 键盘 | Tab/Shift+Tab 可达，焦点可见，弹窗可 Esc 退出并恢复焦点 |
| 性能 | 大表只预览和分页，不把百万行 JSON 传到浏览器 |
| 真值 | 不从 LLM 文案推断完成，指标来自后端 |

最少保存：workspace-empty、dataset-ready、plan-review、run-running、run-failed、run-succeeded 六类截图。桌面两种视口必测；1024/390 响应式验证优先级低于真实链路，但未验证需列出。

截图目录 `docs/modeling-demo/evidence/<date>/`。每张记录浏览器、视口、数据模式（fixture/live）、run_id（如有），不得让含密钥的 URL 或原始敏感记录进入截图。

## 6.4 建议测试结构

```text
services/modeling-api/tests/
  test_plan_validation.py
  test_split_and_leakage.py
  test_upload_profile.py
  test_approval_idempotency.py
  test_run_lifecycle.py
  test_artifact_security.py
  test_skill_versions.py
packages/modeling/.../tests/       # 实際路径由 T00 确认
  client-state.spec.ts
  modeling-tools.spec.ts
  modeling-ui.spec.tsx
tests/modeling-demo/
  happy-path.spec.ts
  failure-and-refresh.spec.ts
  visual-smoke.spec.ts
```

遵循上游测试与构建命令，不用猜出的 npm test。将实际命令写入 REPO_DISCOVERY；命令不存在就是失败，不静默跳过。

## 6.5 独立性能测试

百万行 × 百列测试记录硬件、数据类型/字符串基数、磁盘、文件字节、软件版本、每步 elapsed 和 peak RSS、是否全量、产物大小。Streaming 不表示所有算子都流式，部分操作可能回退到内存；大矩阵转换同样受内存限制。[S12]

默认不承诺“百万行几秒完成”或“8GB 一定够”。只报告实际测量。未做测试使用 `SCALE_NOT_RUN`；不能用 Profile 读完文件推断所有清洗/特征/训练已支持。

## 6.6 完成报告模板

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

最终不要求模型指标“好看”，要求结果真实、可解释、可复验；不将软件 Demo 说成生产级风控平台。


---

# 07｜可直接粘贴的 Codex 指令

以下是开发指令，不是声称系统已实现。复制前先运行安装器，确认本包位于目标 Harness 仓库中。

## 7.1 一次启动，按阶段推进

```text
$modelx-demo-orchestrator

在当前 DeepSeek Harness 仓库开发“智模工作台”两天 Demo。
先读取所有适用的 AGENTS.md / AGENTS.override.md；保留其规则与已有代码。
随后读取 docs/modeling-demo/00-execution-contract.md、01-architecture-and-functions.md、
04-tasks-and-order.md，并按需要读取其他章节。

按 T00→T13 顺序推进，先完成仓库探测和真实计算 Pipeline，再接入 Harness 和三栏界面。
页面严格遵循 docs/modeling-demo/02-ui-design.md，主色 #0F4C9E；
菜单 icon+文字，业务按钮带 icon，主要按钮保留文字，紧凑按钮有 aria-label/Tooltip。
参考 docs/modeling-demo/reference/modelx-reference.png 和 ui/modeling-workspace-preview.html。
不要另外初始化 Vite/Next.js 应用，不改 Agent Loop，不伪造任务状态或模型指标。

每个阶段选择对应项目 Skill，先实现并运行针对性测试，记录真实命令、退出码、截图与问题
到 docs/modeling-demo/progress.md，再继续下一阶段。
所有接口必须基于本地实际源码确认，不编造 Harness API。
开发使用合成数据；产品运行时不得依赖公网；不把开发 Skills 暴露给业务 Agent。
允许在文档范围内连续完成，不自动 push、不删除用户已有变更、不关闭安全限制。
关键依赖或权限阻塞时记录证据并报告，不静默换底座或用 Mock 代替真实验收。

现在先完成 T00，输出 REPO_DISCOVERY.md 和首个 smoke 结果，然后按 Gate 继续。
```

## 7.2 只做仓库接手与协议

```text
$modelx-harness-extension
按 docs/modeling-demo/04-tasks-and-order.md，仅执行 T00、T01、T02。
检查实际版本、前端 Slots、图标体系、Remote、工具上下文、构建和测试入口。
完成 REPO_DISCOVERY、计划/事件类型和校验测试；不开始全量 UI 改造。
不覆盖上游 AGENTS，不修改未涉及的包。结束给出命令证据及 T03 的可实施路径。
```

## 7.3 第一天：完成真实后台

```text
$modelx-data-pipeline
读取 01、03、04、06 章及 progress。仅执行尚未完成的 T03～T06。
先生成可复现的合成 CSV，完成不依赖 LLM 的真实计算，再接四个 Harness 工具。
审批幂等、split-before-fit、目标排除、资源限制、子进程取消和产物权限必须实现。
不使用全量 fit 后再切分。LLM 只生成候选计划；用户确认才执行。
结束必须展示真实 metrics/manifest 的文件位置与测试证据，不能以示意 JSON 代替。
```

## 7.4 页面设计与开发

```text
$modelx-frontend-design
读取 docs/modeling-demo/02-ui-design.md 和参考图，按 T07/T08 实现页面。
不要创建新前端应用；沿用 Harness React/Slots/已有 primitives。
先抽取主题 tokens，再完成 248px 左栏—自适应对话区—320px 任务栏，底部输入不遮挡消息。
主色固定 #0F4C9E，白色内容面板、浅灰蓝背景；菜单 icon+中文文字；全部按钮有 icon。
禁止紫色渐变、巨大营销 Hero、emoji 图标和无响应按钮。
数据概览、待确认计划、工具执行块、结果卡、任务监控都从单一客户端模型读取状态。
先做明确标记的 fixture 状态，再接真实 API；最终不能仍由假进度或硬编码指标驱动。
使用可用的浏览器工具截图检查 1440×900 和 1366×768；记录问题并修复后重新截图。
外部 frontend-design 已安装则按需辅助，但不得覆盖用户视觉规范或重构底座。
```

## 7.5 业务 Skill 与流程编辑

```text
$modelx-skill-authoring
按 T09/T10 实现四个业务 Skill 的轻量管理和有界流程编辑。
先检查 runtime-skills 模板与计划 schema；新增算子需要 Python 实现，不靠修改 Markdown 假装支持。
提供草稿编辑、结构校验、发布不可变版本；历史计划固定 Skill hash。
流程允许参数编辑和可选特征启停，禁止破坏切分/拟合顺序。
改动创建新 plan revision/run；检查缓存/下游失效；不要实现任意 DAG 平台。
```

## 7.6 页面优化专用指令

```text
$modelx-frontend-design
只做现有页面的视觉与交互优化，不改变已通过的业务接口和功能。
按 02-ui-design.md 检查三栏比例、首屏密度、空状态、字体、留白、icon、按钮层次、
卡片/表格一致性、输入框位置、错误状态、键盘焦点和响应式。
先运行真实页面并截图，列出最多 8 个具体问题，按遮挡/溢出→层级→细节的顺序修复。
对照 reference/modelx-reference.png 的信息结构而非复制商标或原紫色主题。
每次修改后重新打开页面与截图，不用概念图充当实测。不引入新 UI 框架或在线资源。
```

## 7.7 验收与交付

```text
$modelx-demo-qa
读取 06-tests-and-acceptance.md，执行 T11～T13。
在真实服务上验证上传→真实 Agent 计划→用户确认→计算→结果下载，验证失败/取消/刷新/重启。
检查未确认写任务、非法计划、路径穿越、跨会话产物访问和开发 Skills 泄露。
运行相关上游检查和本项目测试；记录命令/退出码/日志/截图，NOT_RUN 不得标 PASS。
最终区分：真实已实现、只有界面、未实现；报告规模测试结果或 SCALE_NOT_RUN。
给出可复制启动命令与 5 分钟演示步骤，不自动提交或推送代码。
```

## 7.8 中断后继续

```text
$modelx-demo-orchestrator
先读取适用 AGENTS、REPO_DISCOVERY、progress.md 和 tasks.json。
核对 git diff 与上次验证证据，确认已有工作，再从首个未通过的任务继续。
不要重新生成整个工程；没有证据的“已完成”必须重新验证。
```

## 7.9 并行策略（可选）

只在 T02 契约冻结后并行。一个会话负责 Python/协议，一个负责 UI/组件；不同 worktree/分支，明确文件所有权，不能同时改 lockfile、共享 schema 和主题。协调会话负责合并与 E2E。两天单人任务不需要为了并行先搭多 Agent 调度系统。


---

# 08｜内网部署、执行安全与可复现性

## 8.1 两个边界分别验证

Codex、外部设计 Skill、浏览器工具属于开发环境；Harness + Python + 业务 Skill 属于交付运行环境。运行系统内网可用，不等于把源代码/银行数据发送到云端 Codex 已获批准。开发只用允许共享的代码和合成数据，遵守单位的数据与代码使用授权。

运行时模型选择既有批准的内网 Provider，不写死某个公网型号。配置键、API 协议、tool calling 参数以固定 Harness 版本为准。必须真实测试工具调用和结构化候选计划，不仅测试一句“你好”。

## 8.2 推荐部署入口

优先单 Linux 主机/专用 VM：现有 Nginx 作为浏览器入口，Harness 与 Python API 监听受控地址，计算子进程本地执行。只有浏览器入口对目标网段开放；Python API 不直接对用户开放。

需要 Docker Compose 时，保留相同信任边界，分别构建固定版本镜像。查阅时 Harness Web 对监听/Host/Origin 有安全约束，不能照抄一般服务的 `--host 0.0.0.0`；由 T00 在实际版本确认。[S16]

可落地选项：Harness 与反向代理共享网络命名空间，使代理访问 Harness 的 loopback；或者在同一专用 VM 运行两个进程，由已有 Nginx 代理。不要假设普通 Docker bridge 能直接访问另一个容器的 127.0.0.1。

网关配置保留上游认证、Host/Origin 校验、WebSocket 升级、正确代理头；只添加明确的受信入口。代理可以增加外层认证，但不能用“加了 Basic Auth”替代 Harness 自己的访问控制。没有验证代理/认证前不得把服务直接暴露到公网。

P0 部署脚本由 Codex 在实际环境验证后生成；本资料不提供未经验证的完整 Compose 作为“开箱即用系统”。

## 8.3 离线交付材料

固定源码 commit、Node/pnpm、Python 与依赖锁文件、前端构建产物、必要 native 依赖、镜像 digest、业务 Skill 发布快照和浏览器测试依赖（开发用途）。先联网构建/审查，再按单位流程导入内网。运行时不在线 pip/npm install。

API Key 从服务端环境/受控凭证存储提供，不进前端 bundle、不进 Git。版本清单不能把文件 blob SHA 当成仓库 commit SHA。

离线验证阻断公网访问，保留批准内网模型/服务；运行完整演示并检查请求日志。关闭外发 telemetry/自动插件更新/自动搜索及外部 MCP。记录仍需联网的能力，不宣称仅设置一个环境变量就完成离线部署。

## 8.4 Worker 权限和限制

使用非 root 用户；数据目录最小读写权限；不挂载宿主 home、SSH keys、Docker socket 或整个企业共享盘。Worker 不持有 LLM/provider key；禁止任意代码执行、任意网络工具和动态导入不可信插件。

子进程参数使用列表，shell=False；仅运行代码仓库中经过审查的入口。运行前验证路径位于受控根目录，并防御 symlink/traversal。默认一个计算任务并发，限制输入大小、输出大小、特征数量、线程数和单步/总时长。

超时使用父进程计时并终止进程组，等待退出后释放资源。容器/系统级内存限制由部署落实，不要把 JSON 中 memory_limit 字段当成真正硬限制。普通容器不是对任意恶意代码的完整安全沙箱；本 Demo 从设计上不接受任意模型代码执行。

## 8.5 建议默认值（均可配置，不是测量结果）

| 项目 | Demo 默认 | 说明 |
|---|---|---|
| 并发计算 | 1 | Web 不受训练阻塞 |
| 常规上传 | 100 MiB | 容量测试显式提高，网关/API 同步 |
| 数据预览 | 20 行 | 服务端硬上限 100 |
| 模型摘要 | ≤12 KiB 工具结果 | 全量数据不进上下文 |
| 单次 LLM 请求 | 总时长 120 秒，最多一次有限重试 | 实际网关/思考模式需验证 |
| 基线训练 | 120 秒 | 超时报告失败，不伪造指标 |
| 运行总时长 | 600 秒 | 可按演示机器调整 |
| One-Hot 类别上限 | 每列 32 | 与 schema 一致，可受限调整 |
| 最终特征上限 | 10,000 | 超限明确拒绝或用户调整 |
| 轮询 | 活动页约 1 秒 | 页面隐藏减速，终态停止 |

## 8.6 恢复与审计

启动时处理残留 active run：没有可信活跃 Worker 的运行标记 interrupted；queued 可重新入队。不要根据临时文件存在推断成功。停止后残留 `.partial` 可延后清理，产物读取必须检查完成状态和 hash。

审计用户确认、计划版本、数据 hash、Skill hash、工具调用、执行结果和下载，不记录隐藏推理或敏感完整行。保留 request_id/run_id 便于定位。

## 8.7 发布前最低安全检查

未确认计划无法执行；LLM 没有审批工具；运行时看不到开发 Skill；Python API 无公网端口；下载不能越权/越路径；页面没有外链脚本/CDN；真实密钥不出现在日志/截图/静态文件；异常/取消/重启不产生假成功。


---

# 附录 A｜计划 JSON Schema

```json
{
  "$schema": "https://json-schema.org/draft/2020-12/schema",
  "$id": "urn:modelx-demo:modeling-plan:1.0",
  "title": "ModelingPlanCandidate",
  "description": "Candidate only. User approval and session authorization are not model-provided fields.",
  "type": "object",
  "additionalProperties": false,
  "properties": {
    "schema_version": {
      "const": "1.0"
    },
    "dataset_id": {
      "type": "string",
      "pattern": "^ds_[A-Za-z0-9_-]+$"
    },
    "dataset_sha256": {
      "type": "string",
      "pattern": "^[a-f0-9]{64}$"
    },
    "mode": {
      "enum": [
        "prepare_dataset",
        "binary_classification"
      ]
    },
    "target": {
      "type": [
        "string",
        "null"
      ],
      "minLength": 1
    },
    "positive_label": {
      "type": [
        "string",
        "number",
        "boolean",
        "null"
      ]
    },
    "excluded_columns": {
      "type": "array",
      "items": {
        "type": "string",
        "minLength": 1
      },
      "uniqueItems": true
    },
    "split": {
      "type": "object",
      "additionalProperties": false,
      "properties": {
        "method": {
          "enum": [
            "random",
            "stratified_random"
          ]
        },
        "train_ratio": {
          "type": "number",
          "exclusiveMinimum": 0,
          "exclusiveMaximum": 1
        },
        "validation_ratio": {
          "type": "number",
          "exclusiveMinimum": 0,
          "exclusiveMaximum": 1
        },
        "test_ratio": {
          "type": "number",
          "exclusiveMinimum": 0,
          "exclusiveMaximum": 1
        },
        "seed": {
          "type": "integer",
          "minimum": 0,
          "maximum": 2147483647
        }
      },
      "required": [
        "method",
        "train_ratio",
        "validation_ratio",
        "test_ratio",
        "seed"
      ]
    },
    "preprocessing": {
      "type": "object",
      "additionalProperties": false,
      "properties": {
        "numeric_missing": {
          "enum": [
            "median",
            "constant"
          ]
        },
        "numeric_constant": {
          "type": "number"
        },
        "scale_numeric": {
          "type": "boolean"
        },
        "categorical_missing_value": {
          "type": "string",
          "minLength": 1,
          "maxLength": 64
        },
        "categorical_encoding": {
          "const": "onehot_limited"
        },
        "onehot_max_categories": {
          "type": "integer",
          "minimum": 2,
          "maximum": 256
        }
      },
      "required": [
        "numeric_missing",
        "numeric_constant",
        "scale_numeric",
        "categorical_missing_value",
        "categorical_encoding",
        "onehot_max_categories"
      ]
    },
    "feature_engineering": {
      "type": "object",
      "additionalProperties": false,
      "properties": {
        "date_features": {
          "type": "object",
          "additionalProperties": false,
          "properties": {
            "enabled": {
              "type": "boolean"
            },
            "columns": {
              "type": "array",
              "uniqueItems": true,
              "items": {
                "type": "string",
                "minLength": 1
              }
            },
            "components": {
              "type": "array",
              "uniqueItems": true,
              "items": {
                "enum": [
                  "month",
                  "dayofweek"
                ]
              },
              "minItems": 1
            }
          },
          "required": [
            "enabled",
            "columns",
            "components"
          ]
        }
      },
      "required": [
        "date_features"
      ]
    },
    "models": {
      "type": "array",
      "maxItems": 1,
      "items": {
        "type": "object",
        "additionalProperties": false,
        "properties": {
          "name": {
            "const": "logistic_regression"
          },
          "params": {
            "type": "object",
            "additionalProperties": false,
            "properties": {
              "C": {
                "type": "number",
                "exclusiveMinimum": 0,
                "maximum": 100
              },
              "max_iter": {
                "type": "integer",
                "minimum": 50,
                "maximum": 1000
              }
            },
            "required": [
              "C",
              "max_iter"
            ]
          }
        },
        "required": [
          "name",
          "params"
        ]
      }
    },
    "limits": {
      "type": "object",
      "additionalProperties": false,
      "properties": {
        "max_train_seconds": {
          "type": "integer",
          "minimum": 10,
          "maximum": 300
        },
        "max_run_seconds": {
          "type": "integer",
          "minimum": 30,
          "maximum": 1800
        },
        "max_output_features": {
          "type": "integer",
          "minimum": 10,
          "maximum": 10000
        }
      },
      "required": [
        "max_train_seconds",
        "max_run_seconds",
        "max_output_features"
      ]
    }
  },
  "required": [
    "schema_version",
    "dataset_id",
    "dataset_sha256",
    "mode",
    "target",
    "positive_label",
    "excluded_columns",
    "split",
    "preprocessing",
    "feature_engineering",
    "models",
    "limits"
  ],
  "allOf": [
    {
      "if": {
        "properties": {
          "mode": {
            "const": "binary_classification"
          }
        }
      },
      "then": {
        "properties": {
          "target": {
            "type": "string",
            "minLength": 1
          },
          "positive_label": {
            "not": {
              "type": "null"
            }
          },
          "models": {
            "minItems": 1
          },
          "split": {
            "properties": {
              "method": {
                "const": "stratified_random"
              }
            }
          }
        }
      }
    },
    {
      "if": {
        "properties": {
          "mode": {
            "const": "prepare_dataset"
          }
        }
      },
      "then": {
        "properties": {
          "models": {
            "maxItems": 0
          }
        }
      }
    },
    {
      "if": {
        "properties": {
          "target": {
            "type": "null"
          }
        }
      },
      "then": {
        "properties": {
          "positive_label": {
            "type": "null"
          },
          "split": {
            "properties": {
              "method": {
                "const": "random"
              }
            }
          }
        }
      }
    }
  ]
}
```

# 附录 B｜合法计划示例（非实际数据结果）

```json
{
  "schema_version": "1.0",
  "dataset_id": "ds_example",
  "dataset_sha256": "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
  "mode": "binary_classification",
  "target": "label",
  "positive_label": 1,
  "excluded_columns": [
    "record_id"
  ],
  "split": {
    "method": "stratified_random",
    "train_ratio": 0.6,
    "validation_ratio": 0.2,
    "test_ratio": 0.2,
    "seed": 42
  },
  "preprocessing": {
    "numeric_missing": "median",
    "numeric_constant": 0,
    "scale_numeric": true,
    "categorical_missing_value": "__MISSING__",
    "categorical_encoding": "onehot_limited",
    "onehot_max_categories": 32
  },
  "feature_engineering": {
    "date_features": {
      "enabled": false,
      "columns": [],
      "components": [
        "month",
        "dayofweek"
      ]
    }
  },
  "models": [
    {
      "name": "logistic_regression",
      "params": {
        "C": 1.0,
        "max_iter": 500
      }
    }
  ],
  "limits": {
    "max_train_seconds": 120,
    "max_run_seconds": 600,
    "max_output_features": 10000
  }
}
```


---

# 来源与核验边界

核验日期：2026-09-20。来源均为官方文档或原作者仓库。链接的分支可能变化，实施以本地固定提交为准。本文的架构、范围、UI 数值、API 和任务工时是针对用户需求的设计，不是对 Model X 私有实现的断言。

| 编号 | 来源 | URL | 支持内容 |
|---|---|---|---|
| [S01] | Harness README 与架构 | `https://github.com/deepseek-ai/deepseek-harness/blob/master/README.md` | 插件型底座；开发预览，不保证 API 稳定。 |
| [S02] | Harness Web Client architecture | `https://github.com/deepseek-ai/deepseek-harness/blob/master/docs/subsystems/web-client.md` | Host→Remote→Client Model→UI→Slots→React；不跨 feature 直接导入组件。 |
| [S03] | Harness package.json | `https://github.com/deepseek-ai/deepseek-harness/blob/master/package.json` | 查阅快照 0.1.6-alpha.2 / pnpm11.7.0 / Node 范围；不是用户实装版本。 |
| [S04] | Harness Skills | `https://github.com/deepseek-ai/deepseek-harness/blob/master/docs/subsystems/skills.md` | 运行期 Skills 及项目目录发现；实施须核对固定版本。 |
| [S05] | OpenAI Build skills | `https://developers.openai.com/codex/skills` | 项目 .agents/skills、SKILL.md、显式 $ 调用。官方站点可能重定向至 ChatGPT Learn。 |
| [S06] | OpenAI skills README | `https://github.com/openai/skills/blob/main/README.md` | 已标记 deprecated，指向 openai/plugins。 |
| [S07] | OpenAI plugins README | `https://github.com/openai/plugins/blob/main/README.md` | 当前插件样例与 manifest 组织。 |
| [S08] | OpenAI build-web-apps skills | `https://github.com/openai/plugins/tree/main/plugins/build-web-apps/skills` | 前端开发、调试、React 等 Skill；按实际能力选用。 |
| [S09] | Microsoft Playwright CLI / MCP | `https://github.com/microsoft/playwright-cli` | CLI 安装和浏览器操作；MCP 另见 https://github.com/microsoft/playwright-mcp 。 |
| [S10] | OpenAI Codex MCP | `https://developers.openai.com/codex/mcp` | MCP 配置和命令，不默认授权外部服务。 |
| [S11] | scikit-learn Common pitfalls | `https://scikit-learn.org/stable/common_pitfalls.html` | 先切分；只在训练集拟合预处理，Pipeline 避免泄漏。 |
| [S12] | Polars Streaming | `https://docs.pola.rs/user-guide/concepts/streaming/` | 流式支持有算子限制，不能由此保证所有大数据任务内存。 |
| [S13] | W3C Button Pattern | `https://www.w3.org/WAI/ARIA/apg/patterns/button/` | 可访问名称、键盘交互和状态语义。 |
| [S14] | W3C Contrast Minimum | `https://www.w3.org/WAI/WCAG22/Understanding/contrast-minimum.html` | 普通文字对比度等检查。 |
| [S15] | OpenAI CLI reference | `https://developers.openai.com/codex/cli/reference` | plugin marketplace/list/add 等当前命令；先核对本机帮助。 |
| [S16] | Harness Web App README | `https://github.com/deepseek-ai/deepseek-harness/blob/master/packages/bundle/web-app/README.md` | Web 启动、信任/监听与网络访问限制。 |
| [S17] | Anthropic frontend-design | `https://github.com/anthropics/skills/blob/main/skills/frontend-design/SKILL.md` | 前端视觉设计辅助；未复制第三方 Skill 正文。 |
| [S18] | Vercel web-design-guidelines | `https://github.com/vercel-labs/agent-skills/blob/main/skills/web-design-guidelines/SKILL.md` | UI 审核，原工作流需要在线抓取指南；内网应使用批准快照。 |
| [S19] | OpenAI AGENTS.md | `https://developers.openai.com/codex/guides/agents-md` | 持久化项目指令和层级；不要覆盖上游规则。 |

用户截图：随包 reference/modelx-reference.png，只作可见页面参考。未登录检查点金 Model X 私有应用，也未获取其后端实现。

本包 6 个项目开发 Skill 与 4 个业务 Skill 模板为本次编写；未转发第三方 Skill 完整正文、字体文件或外部插件代码。安装第三方能力时请保留其许可证并检查全部引用资源。

这是开发文档/规范/原型包，不是已经完成的系统源码。文档生成环境完成的检查见包根 QA_REPORT.md；Harness 编译、模型调用、业务 E2E 与百万行性能仍需在用户目标仓库执行。
