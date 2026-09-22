# Source and Verification Scope

English | [中文](SOURCE_NOTES.zh.md)

Verification Date: 2026-09-20. Sources are official documentation or original author repositories. Branches may change; implementation relies on locally pinned commits. The architecture, scope, UI values, APIs, and task hours in this document are designed for user requirements and do not assert the private implementation of Model X.

| ID | Source | URL | Supported Content |
|---|---|---|---|
| [S01] | Harness README & Architecture | `https://github.com/deepseek-ai/deepseek-harness/blob/master/README.md` | Plugin-based foundation; development preview, API stability not guaranteed. |
| [S02] | Harness Web Client architecture | `https://github.com/deepseek-ai/deepseek-harness/blob/master/docs/subsystems/web-client.md` | Host→Remote→Client Model→UI→Slots→React; components are not directly imported across features. |
| [S03] | Harness package.json | `https://github.com/deepseek-ai/deepseek-harness/blob/master/package.json` | Snapshot 0.1.6-alpha.2 / pnpm11.7.0 / Node range; not the user implementation version. |
| [S04] | Harness Skills | `https://github.com/deepseek-ai/deepseek-harness/blob/master/docs/subsystems/skills.md` | Runtime skills and project directory discovery; implementation must verify fixed versions. |
| [S05] | OpenAI Build skills | `https://developers.openai.com/codex/skills` | Project `.agents/skills`, SKILL.md, explicit $ calls. Official site may redirect to ChatGPT Learn. |
| [S06] | OpenAI skills README | `https://github.com/openai/skills/blob/main/README.md` | Marked deprecated; points to openai/plugins. |
| [S07] | OpenAI plugins README | `https://github.com/openai/plugins/blob/main/README.md` | Current plugin samples and manifest organization. |
| [S08] | OpenAI build-web-apps skills | `https://github.com/openai/plugins/tree/main/plugins/build-web-apps/skills` | Frontend development, debugging, React, etc.; select based on actual capabilities. |
| [S09] | Microsoft Playwright CLI / MCP | `https://github.com/microsoft/playwright-cli` | CLI installation and browser operations; see https://github.com/microsoft/playwright-mcp for MCP. |
| [S10] | OpenAI Codex MCP | `https://developers.openai.com/codex/mcp` | MCP configuration and commands; external services are not authorized by default. |
| [S11] | scikit-learn Common pitfalls | `https://scikit-learn.org/stable/common_pitfalls.html` | Split first; fit preprocessing only on training set, use Pipeline to avoid leakage. |
| [S12] | Polars Streaming | `https://docs.pola.rs/user-guide/concepts/streaming/` | Stream support has operator restrictions and cannot guarantee memory for all big data tasks. |
| [S13] | W3C Button Pattern | `https://www.w3.org/WAI/ARIA/apg/patterns/button/` | Accessible names, keyboard interaction, and state semantics. |
| [S14] | W3C Contrast Minimum | `https://www.w3.org/WAI/WCAG22/Understanding/contrast-minimum.html` | Checks for normal text contrast ratios, etc. |
| [S15] | OpenAI CLI reference | `https://developers.openai.com/codex/cli/reference` | Current commands such as plugin marketplace/list/add; verify local help first. |
| [S16] | Harness Web App README | `https://github.com/deepseek-ai/deepseek-harness/blob/master/packages/bundle/web-app/README.md` | Web startup, trust/listening and network access restrictions. |
| [S17] | Anthropic frontend-design | `https://github.com/anthropics/skills/blob/main/skills/frontend-design/SKILL.md` | Frontend visual design assistance; third-party skill body not copied. |
| [S18] | Vercel web-design-guidelines | `https://github.com/vercel-labs/agent-skills/blob/main/skills/web-design-guidelines/SKILL.md` | UI review; original workflow requires online guide scraping; intranet should use approved snapshots. |
| [S19] | OpenAI AGENTS.md | `https://developers.openai.com/codex/guides/agents-md` | Persistent project instructions and hierarchy; do not override upstream rules. |

User screenshots: Included in the package as reference/modelx-reference.png for visible page references only. No login checkpoints or private Model X application access, nor backend implementation details were obtained.

This package includes 6 development skill projects and 4 business skill templates used for this documentation; complete bodies of third-party skills, font files, or external plugin code are not forwarded. When installing third-party capabilities, retain their licenses and verify all referenced resources.

This is a development document/specification/prototype package, not completed system source code. Verification checks performed in the generation environment are documented at QA_REPORT.md in the package root; Harness compilation, model invocation, business E2E tests, and million-line performance must be executed within the user's target repository.
