# AI Model Studio Demo: Supplemental Execution Rules

English | [中文](AGENTS.addendum.zh.md)

This document supplements the existing `AGENTS.md` in the repository without replacing upstream rules. More specific applicable agents/overrides take precedence and must be read first.

**Objective:** Implement a three-column data modeling demo on top of DeepSeek Harness. The entry point is `docs/modeling-demo/00-execution-contract.md`, the execution order is `04-tasks-and-order.md`, and the current status is `progress.md`.

Do not change the framework or rewrite the Agent Loop. Probe real interfaces first, then write extensions. Python whitelist operators execute; LLMs generate candidate plans only. User confirmation is required for execution; model self-approval is prohibited.

**Visual Design:** Use color #0F4C9E. Menu icons and Chinese text are supported. Business buttons include icons while primary buttons retain text labels. Compact icon-only elements must have `aria-label`/Tooltip attributes. Continue using React, Slots, and existing primitives.

**Data Integrity:** Tasks/metrics/artifacts must be real; fixtures must be explicitly identified without claiming passing unrun tests. Data splitting occurs before fitting; use only the training set for fitting. Record data/planning/Skill versions.

**Security & Isolation:** The product runtime does not depend on public networks. Do not expose development Skills to business agents. Never send keys or sensitive data to cloud dev tools.

**Process Discipline:** Write progress logs, test commands/exit codes/screenshots/issues for each stage. Maintain user-submitted changes; do not auto-push, disable security settings, or run unknown install scripts. Use `.agents/skills/modelx-*` paths as needed for professional tasks.
