# 开发进度与证据

当前状态：T00～T10 已完成，G1 与 G2 均通过。T09 已实现四个固定运行时 Skill 的 Session 私有草稿、校验、不可变发布与快照隔离；T10 已实现 capabilities 驱动的有界计划编辑、revision 冲突保护、显式失效说明、幂等重跑与 Run 历史。本轮停止，不进入 T11。

本文件由 Codex 在目标仓库执行时更新，不能把本包自检当成业务验收。

## 当前任务

等待进入 T11 的明确指令；本轮按要求停在 T10 PASS。

## 已通过的 Gate
G0 — 基座可启动、最小扩展可注册：PASS。Web 在 `127.0.0.1:3080` 输出 ready；自定义 `ToolRuntime` 工具注册与执行成功。

G1 — 不依赖 LLM 的计算链路真实完成并导出文件：PASS。合成数据、三份切分数据、预处理器、逻辑回归模型、预测、指标和 manifest 已生成并独立复验。

T04 — 上传与数据 Profile：PASS。上传使用有界分块读取，稳定 hash 对应不可覆盖的原始文件；后台 Profile、受限预览和异常 CSV 拒绝均有测试。

T05 — 任务、审批与持久化：PASS。SQLite 保存计划 revision/hash、运行状态、节点事件和完成产物；真实 Pipeline 由独立进程运行，幂等、单并发、超时、取消、重启中断和会话授权均有测试。

T06 — Harness 领域工具与 Agent 计划：PASS。新的真实 Session `session-8bc8aaf9-3ef1-49fb-91a8-3909e5c030b0` 加载四个运行时 Skill，并依次调用数据 Profile、候选计划、运行状态和运行结果工具；模型可见工具中不含审批、Shell、Python、SQL 或任意网络工具。

G2 — 真实 Agent 候选计划、人工确认、独立执行与结果解释：PASS。计划在确认前保持 `proposed` 且没有 Run；用户确认后 Host Remote 审批路径创建 `run_19b21fa9ea464ef09b47c78cf78181dc`，独立 Worker 成功执行，Agent 读取该 Run 的真实状态与结果并如实解释阈值 0.5 下测试集 F1 为 0。

T07 — 主题与三栏骨架：PASS。现有 Harness 侧栏、建模主栏和 320px 任务/产物栏在 1440×900 与 1366×768 下通过浏览器复核；`#0F4C9E` 主题、icon+中文菜单、业务按钮、独立滚动与显式 `UI PREVIEW / FIXTURE` 模式已落实。

T08 — 业务卡片与任务面板联调：PASS。React-free Session model 恢复真实 dataset/plan/run/result，双击确认只创建一个 Run，刷新不重跑，终态停止轮询；真实 `run_0dc0d8b8375d484da518dd1623a066dd` 成功并生成 13 个完成产物，metrics artifact 通过仅含 artifact ID 的 Host 路由下载。

T09 — 业务 Skill 轻量管理：PASS。Skill 中心仅列出四个运行时业务 Skill；Session 私有 Draft 经 YAML、描述、大小、工具与能力规则校验后发布为不可变版本。`data-analysis` 已通过真实 UI 从 `0.1.0-demo` 发布为 `0.2.0-demo`，旧计划仍保留原版本快照，自动化回归验证新计划使用活动版本。

T10 — 有界流程编辑与重跑：PASS。表单从 `/v1/capabilities` 生成，不接受任意 JSON 或 DAG；目标列不会出现在排除列以外的特征控件中，服务端也拒绝目标泄漏。修改逻辑回归 `C` 从 1.0 到 0.5 创建 r2，记录 Train/Evaluate/Result 失效且如实说明当前全量重算；双击确认只创建一个新 Run，旧 Run 与两个 revision 均保留。

## 阶段记录

```text
日期/任务 ID：2026-09-20 / T00
修改文件：AGENTS.md、AGENTS.md.modelx-backup-20260920T034627446161Z.bak、.agents/skills/modelx-*、docs/modeling-demo/*
实际命令：Kit dry-run/apply、pnpm install --frozen-lockfile、pnpm dsh --profile headless --dump-config、pnpm run build、ToolRuntime probe、pnpm dsh --profile web、headless model smoke、Playwright version/launch、Codex 浏览器截图、pnpm run test:docs
退出码/输出摘要：依赖安装、配置解析、构建和工具 probe 均为 0；Web ready 后主动中断为 130；真实模型因 MISSING_CREDENTIAL 为 1；仓库 Playwright 缺少 Chromium 二进制；文档门禁 19/20 通过，双语配对失败
业务或界面模式：manual
截图/日志路径：Codex 浏览器内联截图；docs/modeling-demo/REPO_DISCOVERY.md 保存命令摘要；未记录 Web 启动 token
检查：G0 PASS；真实模型 Tool Calling 与仓库 Playwright 浏览器执行为 NOT_RUN；文档双语配对 FAIL
阻塞与剩余问题：需要 DeepSeek 凭据才能做真实模型检查；只有用户明确要求后才能运行 dsh-translate-docs；T01 处理 Playwright 浏览器和产品 Skill 隔离
下一任务：T01
```

```text
日期/任务 ID：2026-09-20 / T01
修改文件：docs/modeling-demo/evidence/2026-09-20/t01.json、progress.md、tasks.json
实际命令：find .agents/skills -path '*/modelx-*/*'、python3 -m http.server 4173 --bind 127.0.0.1、Codex 浏览器打开本地预览/点击修改计划/截图
退出码/输出摘要：6/6 Skills 可读取；本地页面 HTTP 200；修改计划弹窗正常打开；静态服务器受控停止后退出码 0
业务或界面模式：manual / fixture
截图/日志路径：Codex 对话内联截图；docs/modeling-demo/evidence/2026-09-20/t01.json
检查：PASS；Playwright Chromium NOT_RUN
阻塞与剩余问题：Playwright 浏览器二进制未安装，按用户要求未下载；文档双语配对门禁仍 FAIL
下一任务：T02
```

```text
日期/任务 ID：2026-09-20 / T02
修改文件：docs/modeling-demo/contracts/modeling-plan.schema.json、docs/modeling-demo/contracts/examples/*.json、services/modeling-api/app/contracts.py、services/modeling-api/contracts/*.ts、services/modeling-api/tests/test_plan_validation.py
实际命令：python3 -m pytest services/modeling-api/tests/test_plan_validation.py -q；pnpm exec tsc --project services/modeling-api/tsconfig.json
退出码/输出摘要：11 个计划/状态测试通过；TypeScript 编译退出码 0
业务或界面模式：fixture
截图/日志路径：docs/modeling-demo/evidence/2026-09-20/t02.json
检查：PASS
阻塞与剩余问题：完整审批与持久化保留到 T05；确认并执行未暴露为模型工具
下一任务：T03
```

```text
日期/任务 ID：2026-09-20 / T03
修改文件：services/modeling-api/app/pipeline.py、run_g1_demo.py、verify_g1_artifacts.py、tests/test_pipeline.py、README.md、README.zh.md、README.i18n.yaml
实际命令：python3 -m pytest services/modeling-api/tests/test_plan_validation.py services/modeling-api/tests/test_pipeline.py -q；python3 services/modeling-api/run_g1_demo.py --output-root .artifacts/modeling-demo/g1-20260920 --rows 1200 --seed 20260920；python3 services/modeling-api/verify_g1_artifacts.py .artifacts/modeling-demo/g1-20260920/run
退出码/输出摘要：14 个测试通过；真实运行退出码 0；12 个产物 hash、切分互斥、模型重载和测试指标复算通过
业务或界面模式：fixture / live local compute；不依赖 LLM
截图/日志路径：docs/modeling-demo/evidence/2026-09-20/g1-summary.json；.artifacts/modeling-demo/g1-20260920/run/manifest.json
检查：G1 PASS；真实模型验证 NOT_RUN；SCALE_NOT_RUN
阻塞与剩余问题：文档双语配对门禁仍 FAIL；完整 HTTP/API、上传、持久化和审批执行属于 T04/T05
下一任务：T04（本轮暂停，不自动进入）
```

```text
日期/任务 ID：2026-09-20 / T04
修改文件：services/modeling-api/app/config.py、database.py、datasets.py、api.py、tests/test_upload_profile.py、README.md、README.zh.md、README.i18n.yaml
实际命令：python3 -m pytest services/modeling-api/tests/test_upload_profile.py -q；python3 services/modeling-api/run_t05_demo.py --output-root .artifacts/modeling-demo/t05-20260920-final --rows 1200 --seed 20260920
退出码/输出摘要：5 个上传/Profile 测试通过；真实上传的 1200 行、8 列合成 CSV 达到 ready，完整数据范围 Profile 与最多 20 行预览生成成功
业务或界面模式：live local HTTP upload/profile；不依赖 LLM
截图/日志路径：docs/modeling-demo/evidence/2026-09-20/t04.json；.artifacts/modeling-demo/t05-20260920-final/t05-summary.json
检查：T04 PASS；SCALE_NOT_RUN
阻塞与剩余问题：未做百万行容量测量；Profile 会扫描完整数据但仅向调用方返回聚合统计和受限预览
下一任务：T05
```

```text
日期/任务 ID：2026-09-20 / T05
修改文件：services/modeling-api/app/database.py、runs.py、worker.py、api.py、run_t05_demo.py、tests/test_run_lifecycle.py、README.md、README.zh.md、README.i18n.yaml
实际命令：python3 -m pytest services/modeling-api/tests/test_run_lifecycle.py -q；python3 -m pytest services/modeling-api/tests -q；pnpm exec tsc --project services/modeling-api/tsconfig.json；pnpm exec oxlint services/modeling-api/contracts --deny-warnings；python3 services/modeling-api/verify_g1_artifacts.py .artifacts/modeling-demo/g1-20260920/run；pnpm run test:docs
退出码/输出摘要：4 个运行生命周期测试与 23 个 modeling-api 测试通过；TypeScript 编译和 lint 通过；G1 产物复验通过；文档门禁保持 19 PASS / 1 FAIL
业务或界面模式：live local HTTP lifecycle / live local subprocess compute；不依赖 LLM
截图/日志路径：docs/modeling-demo/evidence/2026-09-20/t05.json；.artifacts/modeling-demo/t05-20260920-final/t05-summary.json
检查：T05 PASS；真实 LLM、Playwright Chromium、SCALE_NOT_RUN；文档双语配对门禁 FAIL
阻塞与剩余问题：Host 鉴权和 Harness Remote adapter 属于 T06；操作系统 CPU/内存配额尚未实现；23 份 Kit 文档仍缺英文配对
下一任务：T06（本轮暂停，不自动进入）
```

```text
日期/任务 ID：2026-09-20 / T06
修改文件：packages/core/tools/src/index.ts、packages/core/tools/tests/scoped.spec.ts、packages/experimental/modeling/**、.dsh/skills/model-training/SKILL.md、docs/modeling-demo/{progress.md,tasks.json,evidence/2026-09-20/t06.json,evidence/2026-09-20/g2.json}
实际命令：真实 Harness Web Session；Agent 的 skill/profile/propose/status/result 调用；Host Remote approveAndRun；python3 -m pytest services/modeling-api/tests -q；vitest run packages/core/tools/tests/scoped.spec.ts packages/experimental/modeling/tests/modeling.spec.ts；tsc --noEmit；oxlint；verify_g1_artifacts.py；pnpm run test:docs
退出码/输出摘要：真实 DeepSeek Session 和全部 G2 条件通过；Python 26 PASS；Harness 33 PASS；TypeScript、lint、Host build、真实独立子进程计算、模型重载、切分隔离和指标复算通过；docs 保持 19 PASS / 1 FAIL
业务或界面模式：live DeepSeek LLM / live Harness Session / live Modeling API / live independent worker
截图/日志路径：docs/modeling-demo/evidence/2026-09-20/t06.json；docs/modeling-demo/evidence/2026-09-20/g2.json；.artifacts/modeling-demo/t06-harness-home/sessions/--Users-robinzhu-project-dsh-deepseek-harness--/session-8bc8aaf9-3ef1-49fb-91a8-3909e5c030b0/session.v3.jsonl.zstd；Codex 浏览器内联截图；未记录 credential 或 Web 启动 token
检查：G2 的 12 项条件全部 PASS；T06 PASS；G2 PASS；Playwright Chromium、百万行容量、OS CPU/memory 硬配额 NOT_RUN
阻塞与剩余问题：文档双语配对门禁仍 FAIL；以上三个非本轮项目仍为 NOT_RUN。它们不改变本轮 G2 结论。
下一任务：具备进入 T07/T08 的条件，但按用户要求暂停并等待明确指令
```

```text
日期/任务 ID：2026-09-20 / T07
修改文件：packages/experimental/modeling/src/client/{ModelingWorkspace.tsx,ModelingWorkspace.module.css,Navigation.tsx,Navigation.module.css,fixtures.ts,locales.ts,index.ts}、package/tsconfig/tsdown 配置、README 中英文与配对记录、docs/modeling-demo/evidence/2026-09-20/t07.json
实际命令：Harness Web + Modeling patch；Codex in-app browser fixture/live 页面交互；1440×900 与 1366×768 视口截图；tsc Host/Client；oxlint；vitest
退出码/输出摘要：三栏布局、导航、卡片、任务状态和响应式检查通过；Host/Client TypeScript 与 lint 通过；相关 Harness 测试包含在 37 PASS 中
业务或界面模式：fixture visual review / live Harness visual review
截图/日志路径：Codex 浏览器内联 1440×900 与 1366×768 截图；docs/modeling-demo/evidence/2026-09-20/t07.json；浏览器工具未提供持久截图文件路径
检查：T07 PASS；Playwright Chromium NOT_RUN
阻塞与剩余问题：仓库 Playwright Chromium 仍未安装，按用户要求未下载；暗色主题使用可读的品牌色变体，浅色主题主色为 #0F4C9E
下一任务：T08
```

```text
日期/任务 ID：2026-09-20 / T08
修改文件：services/modeling-api/app/{api.py,database.py}、services/modeling-api/tests/test_run_lifecycle.py、packages/experimental/modeling/src/{index.ts,types.ts,client/**}、packages/experimental/modeling/tests/client-model.client.spec.ts、相关 README 中英文与配对记录、docs/modeling-demo/{progress.md,tasks.json,evidence/2026-09-20/t08.json}
实际命令：真实 DeepSeek Session 的 skill/profile/propose/status/result；UI 双击确认与刷新；artifact 下载；sqlite 幂等核验；verify_g1_artifacts.py；pytest；vitest；tsc；oxlint；git diff --check；README 配对检查；pnpm run test:docs
退出码/输出摘要：新 Session、真实 Agent 与 UI/Worker E2E 通过；确认前 Run 数 0，双击确认后且刷新后 Run 数始终 1；最终 succeeded revision 5，13 个完成产物；Python 26 PASS，Harness 37 PASS，TypeScript/lint/G1 复验 PASS；docs 保持 19 PASS / 1 FAIL
业务或界面模式：live DeepSeek LLM / live Harness Session / live browser UI / live Modeling API / live independent worker
截图/日志路径：docs/modeling-demo/evidence/2026-09-20/t08.json；.artifacts/modeling-demo/t06-harness-home/sessions/--Users-robinzhu-project-dsh-deepseek-harness--/session-80fdaa24-3ab1-4c7b-bbb8-fec0bb4a8659/session.v3.jsonl.zstd；.artifacts/modeling-demo/g2-live-20260920/service/runs/run_0dc0d8b8375d484da518dd1623a066dd；Codex 浏览器内联真实结果截图
检查：T08 PASS；自动化断言 63 PASS / 0 FAIL；docs gate 19 PASS / 1 FAIL；Playwright Chromium、百万行容量、OS CPU/memory 硬配额 NOT_RUN
阻塞与剩余问题：初次 Agent 提案回合产生 10 次真实但被协议拒绝的 modeling_propose_plan 调用，随后使用精确现有协议成功保存 proposed 计划；文档双语配对门禁仍因 23 个 Kit 文档缺英文配对而 FAIL；三个非本轮项目保持 NOT_RUN
下一任务：具备进入 T09 的条件，但按用户要求暂停并等待明确指令
```

```text
日期/任务 ID：2026-09-20 / T09
修改文件：services/modeling-api/app/{config.py,database.py,skills.py,api.py}、services/modeling-api/tests/test_skill_and_rerun.py、packages/experimental/modeling/src/{index.ts,tools.ts,types.ts,client/**}、运行时 Skill、相关 README 中英文与配对记录、docs/modeling-demo/{progress.md,tasks.json,evidence/2026-09-20/t09.json}
实际命令：真实 Harness Skill 中心保存 Draft、校验并发布；SQLite 版本/快照核验；python3 -m pytest services/modeling-api/tests -q；vitest；tsc；oxlint
退出码/输出摘要：真实 UI 发布 data-analysis 0.2.0-demo；0.1 与 0.2 不可变记录同时存在；旧计划保持 0.1 快照，新计划活动快照自动化回归通过；Python 32 PASS，Harness 聚焦测试 38 PASS，TypeScript 与 lint PASS；两个 README 配对一致；docs 保持 19 PASS / 1 FAIL
业务或界面模式：live browser UI / live Modeling API / SQLite persistence / focused automated regression
截图/日志路径：docs/modeling-demo/evidence/2026-09-20/t09.json；Codex 浏览器内联 Skill 中心四卡片与 0.2.0-demo 发布后编辑器截图
检查：T09 PASS；凭据未记录；任意 Skill 路径和禁用能力请求均被拒绝
阻塞与剩余问题：最终页面刷新截图因浏览器安全自动审查拒绝 localhost 访问而 NOT_RUN；此前真实 T09 截图已完成；文档总门禁保持既有失败，不绕过
下一任务：T10
```

```text
日期/任务 ID：2026-09-20 / T10
修改文件：services/modeling-api/app/{contracts.py,database.py,api.py}、services/modeling-api/tests/{test_plan_validation.py,test_skill_and_rerun.py}、packages/experimental/modeling/src/{index.ts,types.ts,client/**}、packages/experimental/modeling/tests/client-model.client.spec.ts、相关 README 中英文与配对记录、docs/modeling-demo/{progress.md,tasks.json,evidence/2026-09-20/t10.json}
实际命令：真实受控表单把逻辑回归 C 从 1.0 改为 0.5；双击确认并重跑；SQLite revision/run/幂等核验；python3 services/modeling-api/verify_g1_artifacts.py .artifacts/modeling-demo/g2-live-20260920/service/runs/run_9f109e3bf18549018845d7f8ffa1b3a1；pytest；vitest；tsc；oxlint；文档门禁
退出码/输出摘要：r2 hash d07da343…；显式失效 Train/Evaluate/Result，当前无安全缓存所以完整重算；只创建新 run_9f109e3bf18549018845d7f8ffa1b3a1，旧 Run 保留；新 Run succeeded revision 5，13 个完成产物；12 个核心产物通过模型重载、切分隔离与测试指标复算；Python 32 PASS，Harness 聚焦测试 38 PASS，TypeScript/lint PASS，docs 19 PASS / 1 FAIL
业务或界面模式：live browser UI / live Modeling API / live independent Python worker
截图/日志路径：docs/modeling-demo/evidence/2026-09-20/t10.json；.artifacts/modeling-demo/g2-live-20260920/service/runs/run_9f109e3bf18549018845d7f8ffa1b3a1；Codex 浏览器内联受控计划编辑器截图
检查：T10 PASS；重跑测试集 240 条，正类 1，阈值 0.5，ROC-AUC 0.700152207001522，AP 0.17687589862852446，F1 0，混淆矩阵 [[219,0],[21,0]]
阻塞与剩余问题：Playwright Chromium、百万行容量、OS CPU/内存硬配额保持 NOT_RUN；最终 Run 历史刷新截图因浏览器安全自动审查失败而 NOT_RUN；不影响 API、SQLite 与真实产物证据
下一任务：具备进入 T11 的条件，但按用户要求暂停并等待明确指令
```

## 阶段记录模板

```text
日期/任务 ID：
修改文件：
实际命令：
退出码/输出摘要：
业务或界面模式：live / fixture / manual
截图/日志路径：
检查：PASS / FAIL / NOT_RUN
阻塞与剩余问题：
下一任务：
```
