# 数据 Agent 执行基础

[English](README.md) | 中文

此私有扩展提供经过校验的 DAG、PostgreSQL 流程版本与审批、持久化尝试租约、取消、候选发布、事件游标、通过 dsh 源码 Profile 挂载的带认证内部 Worker HTTP 宿主，远程 HTTP Worker 监督进程与 Docker 隔离、分片上传与不可变导入，以及受控 Skill 版本。[任务台账](../../implementation/tasks.md)记录完整产品范围和待完成工作。

## 开发

从 Harness 根目录执行 `pnpm install --frozen-lockfile`，随后执行 `npm --prefix extensions/data-agent run typecheck` 和 `npm --prefix extensions/data-agent test`。扩展使用根 pnpm 工作区与锁文件。类型检查构建引用的 Cordis 项目，通过源码路径和项目引用解析类型。`DATA_AGENT_TEST_DATABASE_URL` 必须指向名称以 `_test` 结尾的可丢弃 PostgreSQL 16 数据库；测试会清空其 `data_agent` 表。默认使用本机 55439 端口的合成测试库 `data_agent_test`。可通过 `DATA_AGENT_TEST_PYTHON` 指定已安装 Worker 依赖的绝对 Python 路径。

在 Harness 根目录执行 `PYTHONPATH=services/data-worker python3 -m pytest services/data-worker/tests -q`。使用 `node --import ./node_modules/tsx/dist/loader.mjs extensions/data-agent/scripts/export-contracts.ts` 生成共享 JSON Schema。

## 运行规则

`DataAgentService` 必须配置 Pool、明确的租约/重试/并发设置，以及对象校验回调。受信任适配器提供项目成员和 Worker 身份。Python 进程仅接收已解析的尝试输入和独立输出前缀，不接收数据库凭据或继承应用密钥。源码 `.py` 执行器仅由宿主适配器调用，不是独立 Node 应用启动器。

流程编辑使用预期修订号。提交冻结当前版本和审批摘要。草稿布局不影响计算身份。外部引用校验项目成员和已发布摘要；内部引用仅在上游发布后解析。结果回执按尝试和清单摘要幂等。发布与运行内事件游标处于同一事务。待确认候选释放租约。取消保持请求状态，直到执行器确认退出。

`createWorkerHandler` 在 `/v1/worker` 下提供 acquire、heartbeat、progress、submit、failure 和 cancelled POST 路由。宿主配置服务账户凭据 SHA-256 摘要及项目白名单。领取任务返回随机尝试凭据，数据库仅保存摘要。服务凭据不能提交结果，尝试凭据不能领取任务或改变所属身份。挂载处理器前须应用迁移 001–008。处理器自身不监听，监听由 Cordis 宿主管理。经过认证的输入下载和有大小限制的输出上传使 Worker 无需共享存储。远程连接需要另行配置内部 TLS 代理。

## 源码 Profile 宿主

将 [profile.package.json](../../deploy/data-agent/profile.package.json) 复制到新建的 `$DSH_HOME/profiles/data-agent-worker-host/package.json`，并在旁边创建内容为 `[]` 的 `cordis.patch.yml`。根据 [host.config.example.json](../../deploy/data-agent/host.config.example.json) 配置 `DATA_AGENT_HOST_CONFIG` JSON，替换全部占位符并创建绝对路径的存储目录。在 `database_env` 指定的变量中配置数据库凭据，启动前向该库应用迁移 001–008。从 Harness 根目录运行 `pnpm dsh --profile data-agent-worker-host --patch deploy/data-agent/cordis.source.patch.yml`。

源码覆盖层在空 Profile 上挂载控制台日志和领域宿主。宿主仅监听本机回环地址，校验精确的 Host 白名单；远程访问需另行配置内部 TLS 反向代理。连接池大小、数据库/请求超时、退出宽限时间、作业限制和恢复周期均为显式配置。恢复任务串行执行。SIGTERM 关闭监听，宽限时间后中断停滞连接，等待在途请求和恢复任务结束，最后关闭连接池。数据库版本不兼容或初始化失败会中止启动，不会自动迁移。dsh 进程监督器强制执行五秒总退出预算，宿主超时需配置在此预算内；强制退出后，未完成尝试由持久化租约机制恢复。

此 Profile 提供 Worker 和用户账户认证的 `/v1/data` 路由。用户凭据摘要与 Worker 账户分开配置；PostgreSQL 成员角色控制读取、写入和仅所有者可执行的发布。`user_accounts` 为空时禁止用户访问。可选 Harness 覆盖层提供真实 Agent 会话、作用域领域工具和锁定 Skill Provider；企业身份与浏览器界面仍需另外集成。适配器没有独立的服务投影，因此不提供单独的不变量安装器；发布检查由领域服务和对象校验器负责。

## 远程 Worker

使用 `docker build --pull=false -f deploy/data-agent/Worker.Dockerfile -t data-agent-worker:dev .` 构建计算镜像。Dockerfile 固定 Python 基础镜像摘要和运行依赖版本；此开发构建需要下载包，不构成离线交付证据。将 `docker image inspect data-agent-worker:dev --format '{{.Id}}'` 返回的不可变镜像 ID 配入 [remote.config.example.json](../../deploy/data-agent/remote.config.example.json)。显式配置 Docker 可执行文件及其 home 目录的绝对路径、私有持久化监督目录、字节/时间/CPU/内存/PID 预算，以及保存服务凭据的环境变量名。运行 `python3 -B services/data-worker/remote.py --config /absolute/remote.json`；`--once` 最多处理一个新尝试。

只有监督进程接收服务和尝试凭据。每个计算容器禁网、根文件系统只读、无 capabilities、禁止提权，以 UID 65532 运行，只读挂载下载输入，临时和输出挂载设定容量配额。监督进程校验输入/输出 SHA-256 与精确字节数。心跳覆盖传输与计算。确认容器实际退出后才确认取消；重启恢复先停止日志记录的容器，再重放回执或报告中断。持久化私有日志含尝试凭据，必须与监督目录一起保护。容器内计算时限也约束监督进程故障后的运行。此 Docker 后端要求 Linux 容器和具备 `fcntl` 的 POSIX 监督环境。

监督器在清理前持久化白名单失败码，重启后重放。OOM、超时及无效响应分别产生 `MEMORY_LIMIT`、`EXECUTION_TIMEOUT` 和 `INVALID_WORKER_RESPONSE`；领域失败保留 `DIMENSION_LIMIT` 等代码。取消和过期尝试隔离优先处理。异常详情与容器原始 stderr 不进入公开错误。

将 `DATA_AGENT_TEST_IMAGE` 设置为计算镜像 ID，启用真实 HTTP/Docker 集成用例。使用 `--build-arg WORKER_IMAGE=data-agent-worker:dev` 构建 `services/data-worker/tests/fixtures/Dockerfile`，将 `DATA_AGENT_ISOLATION_IMAGE` 设置为测试镜像 ID，以执行内核隔离、取消与重启测试。缺少镜像变量时明确跳过对应测试；记录的验证提供了两个变量。

## 数据中心与 Skill 生命周期

数据路由提供项目创建/列表、限定分片授权、续传分片元数据、整文件 SHA-256 完成校验、不可变导入版本、数据集搜索/分页、队列执行的行列预览、归档保护和 Range 下载。解析选项与字段角色确定新的导入身份，相同请求复用。导入和预览通过 Worker 队列执行。审批适配器接入前，API 导入拒绝坏行隔离选项。未过期的失败上传可以重试。过期未完成上传标记中止，清理等待配置的宽限期并拒绝删除产物引用的前缀。丢弃仅对未引用、未归档产物设置删除标记；历史任务输出保留字节。

Skill 草稿使用乐观修订号，候选冻结完整包摘要。服务端评测器必须覆盖配置的规划/冻结流程通道和回归/留出用例，且无阻断失败，所有者才能发布。评测证据绑定包、用例集与运行环境摘要。发布不改变默认版本；默认选择支持回滚到已发布版本；停用阻止新调用，已有调用 ID 仍加载锁定快照。反馈记录关联调用。HTTP 调用者不能提交评测报告。可选 `quality_evaluation` 配置启用真实 Harness Agent 上的合成基线/候选对比及确定性 Python 校验器。评测会话替换通用编码提示词，只暴露结果提交工具。通过规划校验的 DAG 使用 Worker 引擎实际执行，独立逐行比较原始值、标识、标签和计算结果。冻结计算保留为独立通道。执行轨迹保留失败，不重试失败的模型响应。按 [quality.config.example.json](../../deploy/data-agent/quality.config.example.json) 配置重复次数（至少三次）、超时、Python 可执行文件、字节预算和并发数，将对象放入宿主的 `quality_evaluation` 字段。Python 环境须安装 Worker 依赖，HTTP 超时须容纳整套重复评测。每份输入、完整包、工具调用及响应均记录于 JSONL。报告保留重复结果、失败频率、方差和会话 ID；未知金额成本记为 null。这些用例不能授权业务发布：服务端具备人工审核用例前，仍返回 `BUSINESS_EVALUATION_REQUIRED`。Harness 适配器仅加载明确选择的已发布版本；业务标注评测仍是发布前提。

## Harness 会话

应用迁移 001–008。按 [harness.config.example.json](../../deploy/data-agent/harness.config.example.json) 设置宿主的 `harness` 字段，并将 `DATA_AGENT_SESSION_ROOT` 指向私有持久化目录。在同一 `dsh --profile data-agent-worker-host` 启动命令的 Worker 宿主源码覆盖层后添加 `--patch deploy/data-agent/harness.source.patch.yml`。覆盖层组合已有 Agent loop、JSONL 持久化、工具注册表、Skill 注册表和官方 DeepSeek 适配器。显式设置 `DEEPSEEK_BASE_URL`，通过进程环境提供 `DEEPSEEK_API_KEY`。已测公网端点为 `https://api.deepseek.com`，使用 `deepseek-v4-flash`；连接探针返回服务端模型标识 `deepseek-flash`。公网测试仅发送合成数据。

使用本地已安装的 `qwen3.5:9b` 权重测试时，在仓库根目录运行 `ollama create qwen3.5:9b-harness -f deploy/data-agent/ollama/Modelfile`。[Modelfile](../../deploy/data-agent/ollama/Modelfile) 为别名设置 32K 上下文，不覆盖原模型。在工作台覆盖层之后加载[模型适配器补丁](../../deploy/data-agent/ollama/provider.patch.yml)，设置 `OLLAMA_API_KEY=ollama-local`，并在创建会话前将领域 Harness 的 `runtime.model_id` 设置为 `qwen3.5:9b-harness`。已有会话保留冻结的运行配置。本地集成链路正常，但实测 9B 报告总结包含事实错误，批准前须对照已发布报告核对建议。

经过认证的 `POST /v1/data/:project/sessions` 接收 `{input, skills: [{id, version}]}`；`input` 遵循共享 Skill 输入 Schema，version 为 null 时选择当前已发布默认版本。服务端生成会话 ID，在 PostgreSQL 冻结经过认证的用户、项目、数据集、策略、运行环境和调用 ID。Agent 可见前完成作用域配置。输入上下文、冻结流程默认值、完整提案/算子 Schema 及工具调用/结果进入普通 Harness 会话日志。模型不能通过工具参数选择会话所有者。每次调用均校验 PostgreSQL 成员权限和会话归属。

`POST .../sessions/:id/messages` 接收 `{text, wait_for_idle?}`，默认等待独占请求区间空闲后返回。设置 `wait_for_idle: false` 时以 HTTP 202 确认接收，历史接口提供活动状态与结果；完成前仍以 `SESSION_BUSY` 拒绝并发消息。Web 工作台使用接收模式，避免模型耗时导致 HTTP 超时。`POST .../:id/cancel` 取消对话，数据 Run 保留独立取消协议。进程重启后，`POST .../:id/resume` 加载 JSONL 历史和原调用锁，包括会话创建后已停用的版本。销毁时拒绝新请求、取消运行轮次、等待处理器结束，并在连接池关闭前刷新及销毁 Agent 句柄。

作用域工具包括 `skill`、`read_skill_resource`、`inspect_dataset`、`propose_workflow_patch`、`get_run_snapshot` 和 `read_report`。前两者只加载锁定包及资源。诊断返回已提交 Run，报告仅在 Worker 发布后可读取。提案工具接收 `proposal_json`，包含共享提案字段，会话身份由服务端补充；保存不能批准或执行。Run/报告读取要求会话归属，包括该会话复用的已发布输出。全局 shell 和无关工具被排除，没有工具能授予审批或发布 Skill。初始上下文和结果具备可配置字节限制。真实模型诊断提交测试不构成完整任务链、审批界面或模型驱动的完整 Skill 评测。

## 统一提案与决策

`POST /v1/data/:project/proposals` 接收严格的 `PlanProposal` 对象：流程 ID、预期修订号、可设为 null 的会话身份、目标、流程、已发布证据及其输入/采样范围、每个敏感节点的预期影响和未满足前提。对话与产品客户端使用同一版本事务。响应包含不可变输入版本、参数摘要、确认项和节点修改前后差异。证据必须匹配提案输入，保存草稿前检查已知受保护字段角色。`GET .../proposals/:id` 返回提案、决策历史及过期状态。

经过认证的 `POST .../proposals/:id/decision` 接收 approve/reject、精确提案摘要及理由；批准还要求逐节点全量计算上限 `max_removed_fraction`。未满足前提会阻止批准。`POST .../:id/submit` 接收幂等键，冻结已批准的当前修订。输入或参数改变需要新决策；原 Run 的完全相同重试保留回执。`GET .../runs/:run/candidates/:job` 返回实际影响与输出元数据，不暴露未发布对象路径。其 `/decision` 路由将批准/拒绝绑定到清单摘要及理由。批准重新校验对象摘要、当前流程和取消状态；拒绝保留诊断并停止后代。浏览器审批卡片仍需另外实现。

## 业务任务与重跑

按编号顺序仅应用尚未执行的迁移，最高到 008；不要在新版 Schema 上重放旧迁移。任务提交要求宿主配置 Harness 运行环境。`POST /v1/data/:project/tasks` 接收名称、目标、已发布的全量 DatasetRef 和幂等键，完成上传阶段。`/tasks/:id/submit` 接收严格的 [TaskRun](src/task-contracts.ts) 字段：已批准提案、analysis/processing/features 阶段、前序 Run、可选来源 Run、执行范围、复用标志、显式选择标志、预期任务修订号和幂等键。前序 Run 必须属于本任务并完成其选定工作；进入下一阶段还要求已发布报告或数据集。输入必须属于根数据集或前序任务链。同一阶段可包含多个 Run。

`GET .../tasks/:id` 返回选定链路、分支、阶段 Run 状态和最终导出引用。`/follow` 返回完整替换快照及游标向量；重连时通过 JSON 编码的 `cursor` 查询参数传入游标，获得 `changed`。Run 游标与任务修订号来自同一个 PostgreSQL 快照。`/select` 要求 Run ID 和预期修订号。创建分支仅在显式设置 `select: true` 时切换选择。阶段 Run 成功不代表任务完成：选定链必须覆盖全部阶段，并以通过训练契约检查的已发布 `export` 包结束。Worker 在发布 ZIP、清单和冻结方案前检查分区身份、Schema、受保护字段角色、转换器一致性、分区重叠和质量。

`POST .../runs/:id/rerun` 保留原方案、输入、依赖图和 Skill 锁，不调用 Skill 重新规划；运行环境或策略不兼容时拒绝重跑。修改方案或选择另一 Skill 需要新提案和审批。`scope` 为 `{kind:"all"}`、`{kind:"through",node_id}` 或 `{kind:"from",node_id}`。through 选择指定节点及祖先；from 强制重算指定节点及后代，同时包含其前置依赖。其他节点保持 `not_selected`，不影响 Run 状态。运行到指定节点的 Run 不能据此认定业务阶段完成。

复用必须显式开启，且仅限来源 Run。持久化计算键包含输入版本、校验和、Schema/角色/转换器/切分元数据、算子版本、参数、种子、环境和策略，不包含 Skill 文本。部署时修改算子代码或资源/质量策略，必须同步改变环境或策略摘要。未变化节点只有通过权限、审批影响阈值及输入/输出字节重新校验后，才能复用原 ArtifactVersion。对象缺失、损坏或不兼容会触发重算。没有计算键的旧任务节点不会命中缓存。导出复用保留原方案和生产者身份；流程改变时必须重新导出。进程内缓存不承担任务状态权威。

`POST .../runs/:id/pause` 和 `/resume` 在节点边界停止或恢复领取；暂停调度时正在执行的尝试仍可完成。`/runs/:id/cancel` 仅影响单个 Run；`/tasks/:id/cancel` 阻止后续提交并取消活动分支，保留已发布结果。正在执行的 Worker 确认退出前保持取消请求状态。会话可提供 `business_task_id`；服务端验证选定数据链，并记录任务上下文和 Schema。此类会话额外提供 `get_task_snapshot`、`submit_task_run` 和 `rerun`，提案及重跑来源绑定到会话。模型仍无法调用人工决策工具。

## 支持与限制

CSV 字段在未声明类型时保留为字符串。空字段在未显式将空字符串列为空值标识时保留原值；声明的空值在数值转换前生效。

Worker 支持 UTF-8/GB18030/UTF-16 CSV 和 Parquet 导入、显式表头/空值标识、绑定审批的坏记录隔离、金额舍入/时区策略、稳定行标识、精确诊断、随机/实体/时间/分层切分、仅训练范围的均值/中位数/众数/分位数截尾/缩放/One-Hot 拟合与应用、常量填充、格式规范、类别映射、确定性去重、受限筛选、固定范围处理、算术/日期/缺失特征、保护字段的列选择、质量检查和 Parquet 交付包。不支持的选项和未知算子明确报错。隔离保留原记录位置；CSV 语法损坏仍然失败，因为无法安全恢复记录边界。计算采用内存物化，内存仅受部署资源约束，不保证流式执行。

此扩展是私有 pnpm 工作区，具备经过测试的 dsh 源码 Profile 宿主，通过可选 Web Remote 适配器接入工作台，但尚未纳入上游发布构建。四个源包可进行合成模型评测，但不是通过业务验收或已发布版本。剩余算子、企业身份、RustFS/S3 存储、内部 TLS 部署、业务标注 Skill 评测和离线交付仍在任务台账中。不能将此库作为完整应用部署。

[容量探针](../../evals/data-agent/benchmark.py)仅测量确定性计算，不构成 AC-43 或内网部署验收。[验收台账](../../implementation/acceptance.json)保留全部 54 项要求，不将组件测试标记为产品验收通过。

## 可选三列 Web 工作台

构建 Host 和 Client 库，应用尚未执行的迁移直到 008，并准备启用 Harness 运行环境的既有宿主配置。使用 `pnpm dsh --profile web --patch deploy/data-agent/workbench.source.patch.yml` 启动真实 Web profile。`DATA_AGENT_DOMAIN_ENDPOINT` 必须与领域监听器的源一致，例如 `http://127.0.0.1:55440`。覆盖层默认每 2 秒轮询，浏览器上传缓冲上限为 64 MiB；宿主仍执行自身的上传和正文限制。打开 dsh 输出的认证地址，再输入独立的领域用户凭证。凭证保留在内存中，不写入 localStorage。

左栏负责项目/会话导航及数据、Skill 和模板弹窗。中列渲染实际 Harness 消息、工具结果和摘要绑定的提案决策。右列在权威 Run 状态与可编辑 React Flow 草稿之间切换；查看历史不会改变冻结流程。复制操作创建独立流程身份。受保护变更必须提供证据 JSON，且仍须通过后端验证。Skill 阶段入口使用选定的不可变版本创建新会话，再请求生成提案；未发布或停用的候选不能绕过生命周期检查。领域会话使用自身作用域的数据提示词及原生领域工具，排除通用 Web 编码工具和运行时上下文，并要求模型以简体中文生成面向用户的回复，同时保留精确的代码与数据标识符。

迁移 008 增加会话名称和版本化模板。读取路由提供账号身份、算子 Schema、归属当前用户的会话导航/历史、不可变流程/Skill 版本及有界 JSON 报告。模板写入使用乐观版本校验。Host Remote 通过既有认证 Web 通道转发有界 JSON 和精确的二进制路由；卸载时中止尚未完成的转发。

本地浏览器回归：将 `DATA_AGENT_TEST_DATABASE_URL` 指向库名以 `_test` 结尾的可丢弃数据库，使用已安装 Edge 时设置 `DATA_AGENT_BROWSER_CHANNEL=msedge`（否则使用 Playwright Chromium），运行 `DSH_SNAPSHOT=replay pnpm exec vitest run --config vitest.web.config.ts extensions/data-agent/tests/workbench-browser.e2e.ts`。测试夹具会清空该测试库。只有外部模型使用确定性适配器；Loader、Agent、循环、工具、Remote、浏览器和 PostgreSQL 均为真实实现。此测试不代表 Skill 业务质量、大数据容量或离线部署验收通过。

[全链路容量报告](../../implementation/t14-capacity.md)记录了固定百万行场景通过实际 Web Profile、远程 Worker 和训练导出的结果。可选 `DATA_AGENT_CAPACITY_CONFIG` 测试入口记录资源限制、节点测量及独立全量逐行对账。本地 4 GiB 结果不能证明宽表、高基数编码、多用户并发或目标部署容量。

## 离线交付与恢复

[本地交付操作说明](../../deploy/data-agent/offline/operations.md) 覆盖匹配平台的交付包、完整性校验、停服激活、兼容回退和空库恢复。[T15 证据](../../implementation/t15-operations.md) 记录本地 TLS 浏览器执行和恢复产物校验。目标基础设施与人工业务签收仍待完成。

会话创建可携带可选 model 对象，指定已注册的 provider 和模型 ID。Host 在持久化前通过既有 LLM 服务解析模型，将选中的身份写入会话运行时，并把相同运行时传给 Skill 调用锁。恢复会话保留该身份。鉴权后的 models 查询返回当前 Harness 模型目录，响应不包含地址与凭据值。供应商设置对后续请求仍然实时生效，因此模型身份锁不是不可变的供应商配置快照。

本地凭证配置：领域服务的 `user_credential_min_length` 与控制器的 `credentialMinLength` 均默认20位（可配置范围6–200）。仅在明确需要六位用户凭证的本地测试部署中将两者设为6；Worker认证不受影响。

任务历史支持直接重命名和确认删除。删除仅移除所属用户的历史入口，保留数据集、执行产物和审计日志；运行中的会话或处理任务禁止删除。新任务目标支持示例填入、AI直接生成和按关键词生成，使用当前选择的模型。生成过程通过禁用工具并保留日志的Harness会话完成，不创建业务任务、不读取数据行；生成失败保留已有草稿。

`replace_missing` 将明确列出的字符串标记转为null；`cast_numeric` 将特征严格转换为Int64或Float64，拒绝非法、有损或非有限数值。两者保留受保护角色与原始数据。`get_run_snapshot` 默认省略产物元数据；按需传入 `include_metadata: true` 获取精确字段及变换器链路。独立 `inspect_dataset` 不推进业务任务；任务流程需按顺序提交已审批的分析、处理、特征运行。

特征工程包0.2.0融合Amey-Thakur/AI-SKILLS提交c8c84206e1a05825d8b9dac12a31b3c6c345c649。独立入口覆盖预测时点、泄漏、缺失语义、仅训练集拟合与可复现变换；不支持的方法保留为待复核事项。来源及MIT声明位于references目录，导入包必须携带这些资源。源代码包和候选版本不等于已发布Skill；仍需业务评测与发布。
