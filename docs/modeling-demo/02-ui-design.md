# 02 | Page Design Specification: Dianjin Model X Reference

English | [中文](02-ui-design.zh.md)

## 2.1 Visual Direction and Reference Priority

Positioning: a data-modeling workbench for bank and enterprise development teams. It is clear, restrained, trustworthy, and lightweight. It follows the three-column information organization in the user-provided screenshot without copying its trademarks or code.

Priority: explicit user requirements → the tokens and interaction rules in this document → the reference screenshot structure → existing project component conventions → general guidance from external frontend Skills. An external Skill must not turn the workbench into a purple-gradient marketing site, a dark technology dashboard, or a page dominated by a large hero section.

Reference file: `reference/modelx-reference.png`. It is a static reference supplied by the user and validates only the visible layout; it does not establish how Model X is implemented. `ui/modeling-workspace-preview.html` is the layout reference included in this kit. Every example state is labeled and is not an implemented Agent.

## 2.2 Colors and Base Tokens

| Token | Value | Use |
|---|---|---|
| brand / primary | `#0F4C9E` | Primary buttons, selected items, focus, and important links |
| brand-hover | `#0B3D80` | Primary button hover |
| brand-active | `#083269` | Pressed state |
| brand-soft | `#EAF1FB` | Selected navigation and light message backgrounds |
| app-bg | `#F5F7FB` | Workspace background |
| surface | `#FFFFFF` | Content panels |
| sidebar-bg | `#F8FAFD` | Left navigation |
| text | `#172B4D` | Body text |
| text-secondary | `#596B82` | Explanatory text |
| text-muted | `#6B7C93` | Auxiliary information; verify contrast at small sizes |
| border | `#E2E8F0` | Dividers and card borders; not a replacement for focus styles |
| success | `#147D58` | Success icon and text |
| warning | `#9A6700` | Confirmation-needed or warning icon and text |
| danger | `#B42318` | Failure or stop icon and text |

The token source is `ui/design-tokens.css`. Import it or map it to the existing project theme; do not override upstream variables globally. Normal body text targets a contrast ratio of at least 4.5:1. Verify interactive focus and non-text states against the applicable accessibility standard rather than skipping checks because a brand color looks acceptable. [S13][S14]

Use the system font stack: `-apple-system, BlinkMacSystemFont, "Segoe UI", "PingFang SC", "Microsoft YaHei", sans-serif`. Do not use remote fonts or bundle font files in this kit.

Type sizes: page title 20/28, section title 16/24, body/menu 14/22, table and auxiliary information 12/18. Do not reduce important errors or field labels to 10px. Numbers may use tabular figures.

Spacing: 4/8/12/16/20/24/32px. Corner radii: buttons 8, cards 12, inputs 14. Do not apply oversized radii and shadows to every layer. Cards primarily use thin borders; reserve shadows for overlays.

## 2.3 Three-Column Layout

Target viewport: 1440×900, with support for 1366×768 and 1920×1080.

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

The application uses `height:100dvh; overflow:hidden`; all three columns use `min-width:0; min-height:0`. The session list, middle message area, and right task area scroll independently. The middle column uses `grid-template-rows:56px minmax(0,1fr) auto`. The composer is the last layout row and must not absolutely cover messages. The final message must remain fully visible.

At widths ≥1280: 248 / minmax(480,1fr) / 320. From 1024–1279: the left column is 216 and the right column defaults to a drawer. From 768–1023: the left column can collapse to 72, but its expanded state still uses icons and text. Below 768: both sidebars become drawers and the middle becomes one column; do not compress three columns into unreadably small text.

The middle conversation content has a maximum width of 920px with 24px horizontal padding, reduced to 16px on small screens. Tables and code blocks scroll horizontally within themselves; the page must not scroll horizontally.

## 2.4 Menu and Icon Rules

Use the repository's existing SVG icons and primitives. Fill gaps through one shared Icon adapter. Lucide is an acceptable new source only after confirming its dependency and license; do not assume it is installed. Do not mix emoji, Unicode text icons, and multiple icon libraries with different styles.

| Navigation | Icon meaning (implementation name depends on the library) | Behavior |
|---|---|---|
| New task | Plus | Create a Harness Session and enter the empty state |
| Modeling workbench | Panels / LayoutDashboard | Return to the current three-column workspace |
| Data center | Database | Show the dataset list in the middle column or a drawer |
| Skill center | Wrench / Wand | Open lightweight management for four business Skills |
| Run history | History / Clock | View real runs and open results |
| Settings | Settings | Reuse existing settings without exposing credential contents |

Menus are 40px high with 18px icons, approximately 1.75–2px strokes, and 10px between icon and text. A selected item uses a light-blue background and blue text and may add a 3px left indicator. Hover uses light gray. Selection must not rely on color alone.

Do not show unimplemented Notebook or scenario-lab entries by default. If they must appear, disable them and label them "Coming later"; do not leave empty links or controls with no response.

## 2.5 Button Rules

Every business action button has an icon. Primary buttons use `icon + text`; compact actions such as send, attach, collapse, more, and copy may be icon-only.

| Type | Style | Example |
|---|---|---|
| Primary | Blue background, white text, 36px height, 8px radius | Play + Confirm and run |
| Secondary | White background, thin border, dark text | Pencil + Edit plan |
| Tertiary | Transparent background with a light hover fill | Eye + View data |
| Danger | Light red or red text with explicit confirmation | Square + Stop task |
| Icon-only | 32×32 desktop hit area, 16–18px icon; enlarge appropriately for touch | Send / Download / More |

Important actions such as "Publish Skill," "Confirm execution," and "Delete data" must not be unexplained icons. Icon-only controls require an `aria-label` and Tooltip; native buttons support Enter and Space. Disabled buttons explain why. Loading must not change button width or trigger duplicate actions. [S13]

Define hover, focus, pressed, disabled, and loading feedback. Focus uses a visible blue outline; do not remove the outline. Delete and stop actions are not red primary CTAs.

## 2.6 Key Components

### A. DatasetOverviewCard

Show a file icon, filename, state, sample count, total columns, target/feature counts, size/format, and preview button. Data comes from the server-side Profile. Show a skeleton before analysis and a specific reason plus retry on failure.

Show only four to six important numbers instead of another metric dashboard. Use clear notice rows for high-cardinality warnings and an unselected target.

### B. AgentMessage / ToolExecutionBlock

Align user messages to the right on a light-blue background. Align Agent messages to the left without oversized borders. Tool execution summaries are collapsed by default and show the tool name, start/end state, duration, and readable conclusion. Expansion shows a parameter summary and redacted logs. Name the section "Execution details" and do not expose hidden model reasoning.

Disable raw HTML in Markdown or sanitize it reliably. Render code as text and apply the runtime access policy to external links. Model output must not inject page scripts or counterfeit buttons.

### C. ModelingPlanCard

Show the title "Modeling plan," revision and confirmation-needed state, target column and task type, a collapsible parameter table, and a bounded step list. The footer contains Pencil + Edit plan and Play + Confirm and run.

Disable confirmation and show a reason when the Profile is not ready, the target is missing, the schema is invalid, the data version conflicts, or another conflicting run exists. A plan card becomes read-only after execution. Changes create a new revision instead of silently changing the original card.

### D. TaskMonitor / NodeRow

The right side has "Tasks / Context" tabs. Each task row shows a status icon, node name, and duration and opens details when selected. A thin blue border can identify the current step; the entire card does not need a saturated flashing fill.

State labels: Pending / Running / Confirmation required / Completed / Failed / Canceled / Interrupted / Skipped. A failure shows its reason and a bounded retry. A skipped step does not count as completed work.

### E. ResultCard

Data-preparation mode shows output sample/feature counts, the data split, processing rules, and downloads. Training mode adds real evaluation metrics, validation/test distinctions, the threshold, and sample counts.

Show "— / Not calculated" before a metric exists; do not use 0.92 as a placeholder. Do not fabricate confidence intervals when they are not implemented. Reports, data, and models each have an icon-and-text entry. Collapse large artifact sets into a list.

### F. Composer

Support multiline text. Enter must not submit during IME composition. Enter sends and Shift+Enter inserts a line break, with a user-selectable alternative. File chips include a remove button. Users may still read and ask for status during execution, but cannot start the same plan again.

Show the current dataset and selected Skill below the composer. The send button is a blue rounded-square icon-only control and is disabled for empty input. Attach-file and Skill controls use the shared icon system and must not be unnamed `div` elements.

### G. DatasetDrawer / SkillPanel

The data drawer shows column information and a 20-row preview, with internal scrolling for many columns. The Skill panel follows list → instruction editing → validation results → publish new version. A textarea is sufficient initially; do not introduce Monaco without need.

## 2.7 Required States

Design the empty workspace, uploading, analysis failure, data ready, awaiting confirmation, running, task failure, user cancellation, reconnecting, completed, and no-LLM/manual-mode states. For each state, define its entry condition, page feedback, available actions, and next step.

Empty-state copy: "Upload a CSV to start analysis and modeling." Primary action: "Upload data." Secondary action: "Use demo data." Do not add a marketing headline or unrelated illustration.

Error copy follows "problem + reason + next step." Example: "Training cannot start: the target column contains only one class. Select data with positive and negative samples, or run data preparation only."

## 2.8 Frontend Implementation and Review Loop

Invoke the project `$modelx-frontend-design` Skill; use external `frontend-design` only as an aid. Complete the tokens and three-column skeleton before cards and states. Do not invoke several conflicting visual-design Skills at once.

First pass: 1440×900, checking structure, whitespace, primary color, and controls. Second pass: 1366×768, checking initial-screen density, composer, and scrolling. Third pass: 1024×768 + 390×844, checking drawers, button names, and overflow.

Compare real browser screenshots on each pass and save them under the evidence directory. JSX inspection alone does not establish visual acceptance; record `VISUAL_NOT_RUN` when no browser is available. Capture a new screenshot after a frontend bug fix; an old screenshot cannot verify new code.
