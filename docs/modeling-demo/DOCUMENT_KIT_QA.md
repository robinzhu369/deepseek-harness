# 资料包质量检查报告

日期：2026-09-20。范围：本次生成的 Markdown、Schema、原创项目 Skills、安全复制脚本与静态 HTML 设计参考。

**本报告不证明目标 Harness 应用已完成。真实系统编译、模型调用、建模计算、内网部署与性能测试仍待 Codex 在用户仓库执行。**

## 已执行

| 检查 | 结果 | 证据 |
|---|---|---|
| JSON 语法、JSON Schema 与合法计划/事件示例 | PASS | 资料包根目录 qa/document-validation.json |
| 六个开发 Skill 的 YAML frontmatter | PASS | 资料包根目录 qa/document-validation.json |
| Markdown 显式本地链接、任务依赖顺序及工时汇总 | PASS | 资料包根目录 qa/document-validation.json |
| 品牌主色、HTML 无外部可执行资源 | PASS | 资料包根目录 qa/document-validation.json |
| 安装器默认 dry-run 不写入 | PASS | 资料包根目录 qa/installer-results.json |
| 安装器保留 AGENTS 原文并创建备份 | PASS | 资料包根目录 qa/installer-results.json |
| 重复安装幂等，不重复追加 AGENTS | PASS | 资料包根目录 qa/installer-results.json |
| 已有不同文件拒绝覆盖，目标符号链接拒绝写入 | PASS | 资料包根目录 qa/installer-results.json |
| 任意 code 字段被计划 Schema 拒绝 | PASS | 资料包根目录 qa/installer-results.json |
| 1440×900、1366×768、1024×768、390×844 原型布局 | PASS | 资料包根目录 qa/prototype-browser-results.json 与 ui/preview-*.png |
| 原型页面无横向溢出、按钮均有文字或 aria-label、按钮均带 SVG | PASS | 资料包根目录 qa/prototype-browser-results.json |
| 原型编辑弹窗与 Esc、任务/上下文 Tab、窄屏任务抽屉 | PASS | 资料包根目录 qa/prototype-browser-results.json |
| 原型 JavaScript 无 pageerror、无外部 HTTP 请求 | PASS | 资料包根目录 qa/prototype-browser-results.json |

安装器测试只使用隔离的临时测试目录，没有修改用户 GitHub 仓库。

浏览器使用环境已有 Chromium。由于本环境禁止直接 file:// 导航，测试通过 Playwright 的 page.set_content 加载同一份自包含 HTML；未关闭该导航限制。包内 HTML 与独立 HTML 均已内联主题 CSS，不依赖网络。此项是静态页面渲染/局部交互检查，不是 HTTP 服务或业务端到端检查。

浏览器检查不是完整 WCAG 审计，按钮名称检查也不等于屏幕阅读器实测。输入法、所有键盘路径、完整移动触控和业务状态仍在后续验收范围。

## 尚未执行

| 项目 | 状态 | 原因 |
|---|---|---|
| 用户实际 Harness checkout 的版本/构建检查 | NOT_RUN | 用户仓库与当前提交尚未提供给本次文档任务 |
| 实际 Host 插件、Remote、Slots 业务联调 | NOT_RUN | 本次交付是开发资料，不包含已实现的业务插件 |
| 实际内网 LLM 工具调用与审批闭环 | NOT_RUN | 需要开发环境和批准的模型配置 |
| 真实数据清洗、训练、防泄漏与指标验证 | NOT_RUN | 应按 T03/T11 在目标项目实现和测试 |
| 容器/进程取消、崩溃恢复、权限与安全 E2E | NOT_RUN | 同上 |
| 百万行 × 百列吞吐与峰值内存 | NOT_RUN | 需要目标机器、测试数据和实现 |
| 第三方 Skill/插件安装 | NOT_RUN | 已提供核验说明，不擅自修改用户 Codex |

页面所有样本数、文件大小、计划和对话均明确标记为布局示例。确认按钮只反馈这是静态原型，不训练、不模拟进度、不声称调用了模型。

实施时请使用 docs/modeling-demo/06-tests-and-acceptance.md，逐项保存真实证据。不要把本报告改名成项目的真实业务验收报告。
