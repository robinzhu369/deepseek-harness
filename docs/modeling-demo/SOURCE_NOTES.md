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
