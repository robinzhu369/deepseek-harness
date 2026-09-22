# 07 | Ready-to-Paste Codex Instructions

English | [中文](07-codex-prompts.zh.md)

These are development instructions, not claims that the system is implemented. Run the installer first and confirm that this kit is inside the target Harness repository.

## 7.1 Start Once and Progress by Stage

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

## 7.2 Repository Handoff and Protocol Only

```text
$modelx-harness-extension
按 docs/modeling-demo/04-tasks-and-order.md，仅执行 T00、T01、T02。
检查实际版本、前端 Slots、图标体系、Remote、工具上下文、构建和测试入口。
完成 REPO_DISCOVERY、计划/事件类型和校验测试；不开始全量 UI 改造。
不覆盖上游 AGENTS，不修改未涉及的包。结束给出命令证据及 T03 的可实施路径。
```

## 7.3 Day One: Complete the Real Backend

```text
$modelx-data-pipeline
读取 01、03、04、06 章及 progress。仅执行尚未完成的 T03～T06。
先生成可复现的合成 CSV，完成不依赖 LLM 的真实计算，再接四个 Harness 工具。
审批幂等、split-before-fit、目标排除、资源限制、子进程取消和产物权限必须实现。
不使用全量 fit 后再切分。LLM 只生成候选计划；用户确认才执行。
结束必须展示真实 metrics/manifest 的文件位置与测试证据，不能以示意 JSON 代替。
```

## 7.4 Page Design and Development

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

## 7.5 Business Skills and Workflow Editing

```text
$modelx-skill-authoring
按 T09/T10 实现四个业务 Skill 的轻量管理和有界流程编辑。
先检查 runtime-skills 模板与计划 schema；新增算子需要 Python 实现，不靠修改 Markdown 假装支持。
提供草稿编辑、结构校验、发布不可变版本；历史计划固定 Skill hash。
流程允许参数编辑和可选特征启停，禁止破坏切分/拟合顺序。
改动创建新 plan revision/run；检查缓存/下游失效；不要实现任意 DAG 平台。
```

## 7.6 Page-Polish Instruction

```text
$modelx-frontend-design
只做现有页面的视觉与交互优化，不改变已通过的业务接口和功能。
按 02-ui-design.md 检查三栏比例、首屏密度、空状态、字体、留白、icon、按钮层次、
卡片/表格一致性、输入框位置、错误状态、键盘焦点和响应式。
先运行真实页面并截图，列出最多 8 个具体问题，按遮挡/溢出→层级→细节的顺序修复。
对照 reference/modelx-reference.png 的信息结构而非复制商标或原紫色主题。
每次修改后重新打开页面与截图，不用概念图充当实测。不引入新 UI 框架或在线资源。
```

## 7.7 Acceptance and Delivery

```text
$modelx-demo-qa
读取 06-tests-and-acceptance.md，执行 T11～T13。
在真实服务上验证上传→真实 Agent 计划→用户确认→计算→结果下载，验证失败/取消/刷新/重启。
检查未确认写任务、非法计划、路径穿越、跨会话产物访问和开发 Skills 泄露。
运行相关上游检查和本项目测试；记录命令/退出码/日志/截图，NOT_RUN 不得标 PASS。
最终区分：真实已实现、只有界面、未实现；报告规模测试结果或 SCALE_NOT_RUN。
给出可复制启动命令与 5 分钟演示步骤，不自动提交或推送代码。
```

## 7.8 Resume After Interruption

```text
$modelx-demo-orchestrator
先读取适用 AGENTS、REPO_DISCOVERY、progress.md 和 tasks.json。
核对 git diff 与上次验证证据，确认已有工作，再从首个未通过的任务继续。
不要重新生成整个工程；没有证据的“已完成”必须重新验证。
```

## 7.9 Parallel Strategy (Optional)

Parallelize only after the T02 contract is frozen. One Session owns Python/protocol work and another owns UI/components. Use separate worktrees/branches and explicit file ownership; do not edit the lockfile, shared schema, or theme concurrently. A coordinating Session owns integration and E2E. A two-day single-developer task does not need a Multi-Agent scheduler merely to parallelize work.
