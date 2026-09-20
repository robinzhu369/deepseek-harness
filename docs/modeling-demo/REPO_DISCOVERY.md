# 仓库与环境探测

状态：T00 已完成。探测日期为 2026-09-20，基线为当前 HEAD 对应的发布标签 `dsh-v0.1.6-alpha.2`；已执行 `git rev-parse HEAD` 核验 Git 对象。

| 项目 | 实测值/证据 |
|---|---|
| 仓库路径 / Git remote | `/Users/robinzhu/project/dsh/deepseek-harness`；`https://github.com/deepseek-ai/deepseek-harness.git`；分支 `codex/dev`。 |
| commit SHA（非 blob SHA）/ dirty files | `git rev-parse HEAD` 与精确标签 `dsh-v0.1.6-alpha.2` 指向同一 commit；仓库门禁禁止在维护文档中固化 commit hash，因此以发布标签记录。安装前工作树干净。安装后仅有本 Kit 写入的 `AGENTS.md` 入口、`AGENTS.md.modelx-backup-20260920T034627446161Z.bak`、`.agents/skills/modelx-*` 和 `docs/modeling-demo/`。 |
| 适用 AGENTS / override | 根目录 `AGENTS.md`；文档适用 `docs/AGENTS.md`；后续包代码还适用 `packages/AGENTS.md`、`packages/client/AGENTS.md` 和 `packages/web/AGENTS.md`。未发现 `AGENTS.override.md`。 |
| Node / pnpm / Python | Node `v26.9.0`，满足 `^22.19 || >=24`；pnpm `11.19.0`，与仓库声明的 `pnpm@11.7.0` 不同；Python `3.10.20`。 |
| 实际构建/开发/测试命令 | 根 `package.json` 提供 `pnpm run build`、`pnpm run typecheck`、`pnpm run test`、`pnpm run lint`、`pnpm run test:docs`；应用由 `pnpm dsh --profile <profile>` 启动。`pnpm install --frozen-lockfile` 和 `pnpm run build` 已成功。 |
| 相邻工具注册实现与上下文字段 | 使用 `ctx.tools.register(defineTool(...))`，注册函数返回 disposer；执行输入的 `agent` 提供受信任的 `id`、`session` 和 `ctx`。建模工具应从 `exec.agent.session` 推导会话归属，不接受模型传入的 session id。 |
| 实际 Web Slot / Conversation 节点接口 | UI 插槽使用 `ctx.slots.register` / `ctx.slots.inject`；业务消息卡使用 `ctx.uiConversation.events.register(ConversationNodeDefinition)`。右栏已有 `sidebar.right.pane.tab` 与 `sidebar.right.pane.title`，全局侧栏入口使用 `sidebar.panellist`。组件接收派生 props，不直接持有 Cordis context。 |
| Remote / 文件上传下载扩展接口 | Host 服务继承 `TypertRemoteService` 并以 `@Remote` 暴露方法。二进制上传可沿用 `connection.fetch.register` 的流式 request body 模式；下载可沿用认证围栏内的精确 GET/HEAD 路由、服务端会话查找和流式 `Response`。 |
| 图标和基础组件来源 | 使用 `packages/client/ui-primitives` 内的仓库 SVG 图标、`Button` 和 `Tooltip`；不引入新的图标库。 |
| 内网模型协议 / Tool Calling smoke | `DEEPSEEK_API_KEY` 未设置，真实模型调用为 `NOT_RUN`。不依赖模型的 `ToolRuntime` smoke 已注册并执行 `modelx_t00_probe`，返回结构化 `echo: "ok"`。 |
| Python 子进程 / 资源限制方式 | FastAPI `0.128.8`、Pydantic `2.12.5`、Polars `1.0.0`、scikit-learn `1.4.0`、pytest `9.0.3` 可导入。现有 `ctx.subprocess` 支持显式 argv、cwd、环境清理、stdio 上限、取消和退出等待；它不提供 CPU/内存限额，T05 必须在建模 worker 侧补充资源限制和超时。 |
| 浏览器工具 / 截图能力 | Codex 内置浏览器可发现、绑定标签页并生成内联截图。仓库 Playwright 为 `1.61.1`，但本机缓存缺少 Chromium 可执行文件，因此仓库 Playwright 浏览器启动当前为 `NOT_RUN`。 |
| 反向代理 / Host / Origin 约束 | Web 配置仅接受 `127.0.0.1` 或 `0.0.0.0`；普通访问应使用 loopback。`/api` 认证通过启动 token 换取 HttpOnly、SameSite=Strict cookie，并校验 Host、Origin 和可信主机。实测 Web 在 `127.0.0.1:3080` 就绪。 |
| 运行期 Skill 隔离方式 | 默认 skill filesystem 会扫描项目 `.dsh/skills` 和 `.agents/skills`。产品 Agent 应使用 Agent Preset 和 `includeDefaultRoots: false` 的独立 skill provider，仅显式加载建模业务 Skills，避免把开发编排 Skills 暴露给产品会话。 |
| T06 可信上下文与用户标识 | `ToolRunContext.agent` 是已注册工具可获得的可信调用方；`agent.id` 是 Session ID，运行时扩展还提供 `agent.session.header.cwd` 作为 workspace。工具参数不接受 session、workspace、user 或服务地址。当前该上下文没有独立 user ID；Web Gateway 的启动令牌会交换为 HttpOnly、SameSite=Strict Cookie，并以 Host/Origin 校验建立人工调用边界。 |
| T06 Host / Remote 接线 | `packages/experimental/modeling/src/index.ts` 继承 `TypertRemoteService`；四个 Agent 工具通过 `ctx.tools.register(defineTool(...))` 调用私有 API，人工 `approveAndRun` 通过 `@Remote` 接收 Typert 解析的实时 `Agent`。模型工具列表不包含审批方法。 |
| T06 preset 权限与 Skills | `packages/experimental/modeling/presets/modeling/agent.cordis.yml` 使用 scoped `ctx.tools.restrict({ allow: [] })` 屏蔽继承工具；同 scope 仅注册四个建模工具和标准 `skill` 加载器。`skill-filesystem` 设置 `includeDefaultRoots: false`，只扫描 `.dsh/skills` 下四个运行时业务 Skill。 |
| 最小扩展成功证据 | `--dump-config` 退出码 0；全仓构建退出码 0；自定义工具注册与执行退出码 0；Web 输出 ready 后受控停止。G0 已满足。 |

## 实现结论

保持当前 Harness 和 Web 应用，在现有 Cordis 扩展点上新增建模领域插件，不创建新前端应用，不修改 Agent Loop。会话归属、上传下载鉴权、任务状态和产物访问必须由服务端从受信任上下文推导。产品 Agent 使用受限 Preset、显式业务 Skills 和精确工具集合；固定数据处理 Pipeline 先于真实 LLM 集成实现。

## 验证记录

| 命令或检查 | 结果 |
|---|---|
| `python3 install.py --repo /Users/robinzhu/project/dsh/deepseek-harness` | 退出码 0；预览 53 个新文件、0 个冲突、0 个写入。 |
| `python3 install.py --repo /Users/robinzhu/project/dsh/deepseek-harness --apply --merge-agents` | 首次因 sandbox 写入 `.agents/skills` 失败；按原命令获得最小权限后退出码 0，新增 12 个剩余文件、跳过 41 个相同文件并追加 `AGENTS.md`。 |
| `pnpm install --frozen-lockfile` | 退出码 0；锁文件未改动，复用 1314 个包且下载 0 个包。 |
| `env DSH_HOME=/private/tmp/modelx-t00-dsh-home pnpm dsh --profile headless --dump-config` | 退出码 0。 |
| `pnpm run build` | sandbox 内因 tsx IPC 权限失败；以同一命令获得最小权限后退出码 0。 |
| `pnpm exec tsx -e '<ToolRuntime probe>'` | 最终退出码 0；schema、文本结果和结构化结果均符合预期。 |
| `env DSH_HOME=/private/tmp/modelx-t00-web-home DSH_TELEMETRY_MODE=DISABLED pnpm dsh --profile web` | 服务输出 `127.0.0.1:3080` ready；验证后主动中断，进程退出码 130。未记录启动 token。 |
| `env DSH_HOME=/private/tmp/modelx-t00-dsh-home DSH_TELEMETRY_MODE=DISABLED pnpm dsh --profile headless "Reply with exactly: modelx-model-smoke-ok"` | `NOT_RUN`；退出码 1，明确报错 `MISSING_CREDENTIAL`。 |
| `pnpm exec playwright --version` 和 Chromium launch | Playwright 版本检查退出码 0；浏览器 launch 因缺少已安装的 Chromium 二进制而未执行。 |
| Codex 浏览器 inventory、标签页绑定与截图 | 通过；已生成内联空白页截图，没有写入截图文件。 |
| `pnpm run test:docs` | 19 个门禁通过、1 个失败。唯一失败为本 Kit 的 23 个中文文档尚未建立仓库要求的双语配对；按根规则，未获用户明确要求时不运行 `dsh-translate-docs`。 |

## 阻塞项与下一步

真实模型 Tool Calling 需要用户提供可用的 DeepSeek 凭据；在此之前保持 `NOT_RUN`。仓库 Playwright 测试需要安装匹配版本的浏览器二进制，T01 决定是否安装；Codex 内置浏览器已经可用于页面检查。文档门禁的双语配对仍未完成，必须由用户明确要求后才能运行翻译流程。pnpm 版本漂移暂未导致安装或构建失败，但后续复现证据必须记录实际版本。下一任务为 T01，验证项目 Skills 的发现与隔离，并准备浏览器测试能力。
