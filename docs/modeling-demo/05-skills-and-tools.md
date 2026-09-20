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
