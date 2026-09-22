# 05 | Codex Skills, Frontend Tools, and Integration

English | [中文](05-skills-and-tools.zh.md)

## 5.1 Keep the Two Skill Sets Separate

**Development Skills** tell Codex how to inspect the repository, build pages, implement APIs, and test. They live at `.agents/skills/modelx-*/SKILL.md` in the development repository.

**Runtime Skills** tell the data-modeling Agent how to analyze, clean, engineer features, and train. Templates live under this kit's `runtime-skills/` directory and are published to a dedicated `.dsh/skills/` runtime directory or controlled SkillProvider during implementation.

Harness may also scan `.agents/skills`, so names and directories alone do not provide isolation. The runtime must not mount the development `.agents` tree. Use a dedicated workspace/home without the development repository, or replace the provider with one that allows only the four business Skills. Test the visible Skill list and confirm that development Skills are absent. [S04]

## 5.2 Six Project Skills Included in This Kit

| Name | Invocation | Work product |
|---|---|---|
| `$modelx-demo-orchestrator` | Start development or resume an unfinished stage | T00–T13 execution, progress updates, Gate checks |
| `$modelx-harness-extension` | Add tools, Remotes, cards/Slots, or context | Compatible extensions and tests without kernel changes |
| `$modelx-frontend-design` | Three-column pages, cards, icons, theme, and polish | Pages and screenshots that follow the #0F4C9E rules |
| `$modelx-data-pipeline` | CSV, cleaning, features, training, and state | Leakage-resistant Pipeline, allowlisted plans, and real artifacts |
| `$modelx-skill-authoring` | Modify, validate, or publish business Skills | Immutable versions, minimal evaluations, and boundary checks |
| `$modelx-demo-qa` | E2E, failure, security, and visual acceptance | Commands, exit codes, screenshots, and real delivery inventory |

These are local Skills authored for this project, not claims about built-in Codex capabilities. After running `install.py`, use `/skills` in the CLI/IDE to check discovery and reference them explicitly with `$skill-name`; restart Codex if they do not appear. The current official documentation continues to support project `.agents/skills`. [S05]

Do not place all six documents in one Prompt. The entry Skill selects the current stage and loads the relevant specialist Skill and section as needed.

## 5.3 Recommended External Tools: Small and Focused

| Tool/Skill | Recommendation | Use and limits |
|---|---|---|
| Anthropic `frontend-design` | Optional design aid | Design tokens, layout, and visual review; user theme and enterprise UI rules take priority |
| OpenAI `react-best-practices` from `build-web-apps` | Optional code review | Review React components and performance without migrating to Next.js |
| OpenAI `frontend-testing-debugging` | Use when installed and callable | Browser-debugging aid; still preserve reproducible tests |
| Playwright CLI + Skills | Preferred browser option | Operate the local page, capture screenshots, inspect state; write separate automated regression tests |
| Playwright MCP | Alternative when already available | Useful for persistent browser context; no need to install it beside the CLI |
| Vercel `web-design-guidelines` | Optional review | Accessibility/interaction review; its source requires network access, so use an approved snapshot offline |
| `$skill-creator` | Invoke when a new Skill is actually required | Do not add a complex Skill-generation system for a two-day Demo |

Do not install many Skills merely to appear fully equipped. A project without a Figma design does not need Figma first. A project without required third-party documentation does not need Context7 first. The product must not depend on these external development services during runtime.

### Important Version Change

At the time of review, the `openai/skills` README marked the repository deprecated and pointed to `openai/plugins`. Do not treat the old curated path as a permanent installation mechanism. Local project Skills remain directly usable. [S06][S07]

The current `build-web-apps` package in `openai/plugins` includes frontend-app-builder, frontend-testing-debugging, and react-best-practices. `frontend-app-builder` focuses on a complete visual concept and requires image-generation/browser prerequisites. This project already has a screenshot and tokens, so its local specialist Skill takes priority and an additional design-generation flow must not block the two-day implementation. [S08]

## 5.4 Integration Commands

Check these commands in the user's development terminal, not in the product runtime:

```bash
codex --version
codex --help
codex plugin --help
codex mcp --help
```

Older versions may not provide `codex plugin`. In that case, use the local Skills in this kit rather than making a Codex upgrade a prerequisite for business development. Do not automatically enable dangerous permissions or disable approvals.

### Project Skills: No External Download

Run from the extracted directory:

```bash
python3 install.py --repo /absolute/path/to/deepseek-harness
# 上一条只预览；确认后执行：
python3 install.py --repo /absolute/path/to/deepseek-harness --apply --merge-agents
```

By default, the installer does not overwrite different existing content or change network/model configuration. `--merge-agents` only appends a short index to the root AGENTS.md and creates a backup; it does not replace upstream rules. An applicable AGENTS.override.md takes priority, and the entry Prompt explicitly requires reading this kit.

### Playwright CLI: After Network Access Is Approved on the Development Machine

Install and inspect help according to Microsoft's official procedure: [S09]

```bash
npm install -g @playwright/cli@latest
playwright-cli --help
playwright-cli install --skills
```

This is a first-time connected setup example, not a reproducible pinned deployment command. After confirming it works, record the resolved version, preinstall browsers and dependencies, and use a pinned version/cache on the private network. Runtime must not access npm. Inspect generated installation files and do not overwrite an existing Skill.

Example Codex instruction:

```text
使用 playwright-cli 检查本地智模工作台。
先读取 playwright-cli --help，不猜测命令。
验证上传→计划→确认→运行→下载，保存 1440×900 和 1366×768 截图。
截图是视觉证据，测试结果需要实际动作与断言；不要只截图就宣布通过。
```

### Existing MCP Workflow

```bash
codex mcp add playwright -- npx -y @playwright/mcp@latest
codex mcp list
```

The command structure follows Codex MCP documentation and the component follows Microsoft Playwright MCP. Pin the test version, use an isolated browser profile, and restrict access to approved local addresses. [S09][S10]

### Optional External Skill

Enter this in Codex rather than executing `$skill-installer` in a shell:

```text
$skill-installer
从 anthropics/skills 仓库的 skills/frontend-design 安装 frontend-design。
先核对路径、完整 SKILL.md、引用文件和许可证；不覆盖已存在版本。
若无法访问网络，记录未安装，继续使用本项目 modelx-frontend-design。
```

Discover the new plugin entry point before installation; do not guess the marketplace name:

```bash
codex plugin marketplace list --json
codex plugin list --available --json
# 若官方源未配置且联网已批准，可执行：
codex plugin marketplace add openai/plugins
codex plugin list --available --json
# 从返回结果选取实际 marketplaceName，随后：
# codex plugin add build-web-apps@<实际marketplaceName>
```

Replace `<实际marketplaceName>` with the discovered value; it is not a literal command argument. Installation changes the local Codex capability set and requires user review. A product service must not perform it. [S15]

## 5.5 Combinations by Stage

T00/T06: modelx-harness-extension plus upstream repository documentation.

T03/T05: modelx-data-pipeline plus pytest.

T07/T08: modelx-frontend-design; consult frontend-design only when creative calibration is needed; the implementation must remain within the repository.

T11/T12: modelx-demo-qa plus Playwright, with optional React or web-design-guidelines review. When offline, use this document's checklist and do not claim to have checked the latest online rules.

Tool failures must remain visible. Record VISUAL_NOT_RUN when no screenshot tool exists; do not substitute a concept image for a measured browser screenshot.
