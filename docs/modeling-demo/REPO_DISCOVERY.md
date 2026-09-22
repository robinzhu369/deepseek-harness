# Repository and Environment Probe

English | [中文](REPO_DISCOVERY.zh.md)

Status: **T00** Completed. Probed on `2026-09-20`, baseline is the release tag corresponding to current HEAD, `dsh-v0.1.6-alpha.2`; verified Git objects via `git rev-parse HEAD`.

| Item | Measured Value / Evidence |
|---|---|
| Repository Path / Git remote | `/Users/robinzhu/project/dsh/deepseek-harness`；`https://github.com/deepseek-ai/deepseek-harness.git`；branch `codex/dev`. |
| commit SHA (non-blob) / dirty files | `git rev-parse HEAD` and exact tag `dsh-v0.1.6-alpha.2` point to the same commit; repository gatekeeper prohibits hardcoding commit hashes in maintenance documentation, so release tags are recorded instead. The working tree is clean before installation. After installation, only entries written by this Kit exist: `AGENTS.md`, `AGENTS.md.modelx-backup-20260920T034627446161Z.bak`, `.agents/skills/modelx-*`, and `docs/modeling-demo/`. |
| Applicable AGENTS / override | Root directory `AGENTS.md`; documentation applies to `docs/AGENTS.md`；subsequent package code also applies to `packages/AGENTS.md`, `packages/client/AGENTS.md`, and `packages/web/AGENTS.md`. No `AGENTS.override.md` found. |
| Node / pnpm / Python | Node `v26.9.0`, satisfying `^22.19 || >=24`; pnpm `11.19.0`, differing from repository declaration of `pnpm@11.7.0`; Python `3.10.20`. |
| Actual build/dev/test commands | Root `package.json` provides `pnpm run build`, `pnpm run typecheck`, `pnpm run test`, `pnpm run lint`, and `pnpm run test:docs`. Applications are started via `pnpm dsh --profile <profile>`. Both `pnpm install --frozen-lockfile` and `pnpm run build` succeeded. |
| Adjacent tool registration implementation and context fields | Uses `ctx.tools.register(defineTool(...))`; the registered function returns a disposer; execution input of `agent` provides trusted `id`, `session`, and `ctx`. Modeling tools should derive session ownership from `exec.agent.session` and must not accept model-provided session IDs. |
| Actual Web Slot / Conversation node interface | UI slots use `ctx.slots.register` / `ctx.slots.inject`; business message cards use `ctx.uiConversation.events.register(ConversationNodeDefinition)`. The right panel already has `sidebar.right.pane.tab` and `sidebar.right.pane.title`, while the global sidebar entry uses `sidebar.panellist`. Components receive derived props and do not directly hold Cordis context. |
| Remote / file upload/download extension interfaces | Host service inherits from `TypertRemoteService` and exposes methods via `@Remote`. Binary uploads can follow the streaming request body pattern of `connection.fetch.register`; downloads can follow precise GET/HEAD routes within authentication fences, server-side session lookup, and streaming `Response`. |
| Icons and base component sources | Uses repository SVG icons from `packages/client/ui-primitives`, along with `Button` and `Tooltip`; no new icon libraries are introduced. |
| Intranet model protocol / Tool Calling smoke | `DEEPSEEK_API_KEY` is not set; real model calls are **NOT_RUN**. Model-independent `ToolRuntime` smoke has been registered and executed via `modelx_t00_probe`, returning structured `echo: "ok"`. |
| Python subprocess / resource limit methods | FastAPI `0.128.8`, Pydantic `2.12.5`, Polars `1.0.0`, scikit-learn `1.4.0`, and pytest `9.0.3` are importable. Existing `ctx.subprocess` supports explicit argv, cwd, environment cleanup, stdio limits, cancellation, and exit waiting; it does not provide CPU/memory quotas, so T05 must supplement resource limits and timeouts on the modeling worker side. |
| Browser tools / screenshot capabilities | Codex built-in browser can discover, bind tabs, and generate inline screenshots. Repository Playwright is `1.61.1`, but native cache lacks Chromium executable files; thus repository Playwright browser startup is currently **NOT_RUN**. |
| Reverse proxy / Host / Origin constraints | Web configuration accepts only `127.0.0.1` or `0.0.0.0`; normal access should use loopback. `/api` authentication exchanges a start token for HttpOnly, SameSite=Strict cookies and validates Host, Origin, and trusted hosts. Measured web is ready at `127.0.0.1:3080`. |
| Runtime Skill isolation methods | Default skill filesystem scans project `.dsh/skills` and `.agents/skills`. Product Agents should use Agent Presets with independent skill providers setting `includeDefaultRoots: false`, explicitly loading only modeling business Skills to avoid exposing development orchestration Skills to product sessions. |
| T06 Trusted Context and User Identification | `ToolRunContext.agent` is the trusted caller available for registered tools; `agent.id` is the Session ID, while runtime extensions also provide `agent.session.header.cwd` as workspace. Tool parameters do not accept session, workspace, user, or service addresses. Currently this context lacks a separate user ID; Web Gateway start tokens are exchanged for HttpOnly, SameSite=Strict Cookies and establish artificial call boundaries via Host/Origin validation. |
| T06 Host / Remote wiring | `packages/experimental/modeling/src/index.ts` inherits from `TypertRemoteService`; four Agent tools invoke private APIs via `ctx.tools.register(defineTool(...))`, while manual `approveAndRun` receives real-time `Agent` parsed by Typert via `@Remote`. Model tool lists do not include approval methods. |
| T06 preset permissions and Skills | `packages/experimental/modeling/presets/modeling/agent.cordis.yml` uses scoped `ctx.tools.restrict({ allow: [] })` to block inherited tools; within the same scope, only four modeling tools and standard `skill` loaders are registered. `skill-filesystem` sets `includeDefaultRoots: false`, scanning only four runtime business Skills under `.dsh/skills`. |
| Minimum extension success evidence | Exit code 0 for `--dump-config`; exit code 0 for full repository build; exit code 0 for custom tool registration and execution; controlled stop after Web output ready. G0 is satisfied. |

## Implementation Conclusion

Maintain current Harness and Web application, adding modeling domain plugins on existing Cordis extension points without creating new frontend applications or modifying the Agent Loop. Session ownership, upload/download authentication, task status, and artifact access must be derived by the server-side from trusted contexts. Product Agents use restricted Presets, explicit business Skills, and precise tool sets; fixed data processing Pipelines are implemented prior to real LLM integration.

## Verification Record

| Command or Check | Result |
|---|---|
| `python3 install.py --repo /Users/robinzhu/project/dsh/deepseek-harness` | Exit code 0; previewed 53 new files, 0 conflicts, 0 writes. |
| `python3 install.py --repo /Users/robinzhu/project/dsh/deepseek-harness --apply --merge-agents` | Failed initially due to sandbox write into `.agents/skills`; obtained minimum permissions via original command with exit code 0, added 12 remaining files, skipped 41 identical files, and appended `AGENTS.md`. |
| `pnpm install --frozen-lockfile` | Exit code 0; lock file unchanged, reused 1314 packages, downloaded 0 packages. |
| `env DSH_HOME=/private/tmp/modelx-t00-dsh-home pnpm dsh --profile headless --dump-config` | Exit code 0. |
| `pnpm run build` | Failed inside sandbox due to tsx IPC permission issues; exit code 0 obtained with minimum permissions via same command. |
| `pnpm exec tsx -e '<ToolRuntime probe>'` | Final exit code 0; schema, text results, and structured results meet expectations. |
| `env DSH_HOME=/private/tmp/modelx-t00-web-home DSH_TELEMETRY_MODE=DISABLED pnpm dsh --profile web` | Service output `127.0.0.1:3080` ready; actively interrupted after verification, process exit code 130. Start token not recorded. |
| `env DSH_HOME=/private/tmp/modelx-t00-dsh-home DSH_TELEMETRY_MODE=DISABLED pnpm dsh --profile headless "Reply with exactly: modelx-model-smoke-ok"` | **NOT_RUN**; exit code 1, explicitly erroring `MISSING_CREDENTIAL`. |
| `pnpm exec playwright --version` and Chromium launch | Playwright version check exit code 0; browser launch did not execute due to missing installed Chromium binary. |
| Codex browser inventory, tab binding, and screenshots | Passed; generated inline blank page screenshot without writing a screenshot file. |
| `pnpm run test:docs` | 19 gates passed, 1 failed. The only failure is that this Kit's 23 Chinese documents have not yet established the repository-required bilingual pairing per root rules; `dsh-translate-docs` does not run unless explicitly requested by a user. |

## Blockers and Next Steps

Real model Tool Calling requires users to provide available DeepSeek credentials; keep **NOT_RUN** until then. Repository Playwright tests require installing matching browser binaries, T01 decides whether to install them; Codex built-in browsers are already usable for page checks. Bilingual pairing for documentation gates remains incomplete and must be run only upon explicit user request. pnpm version drift has not yet caused installation or build failures, but subsequent reproduction evidence must record actual versions. The next task is T01: verify project Skills discovery and isolation, and prepare browser testing capabilities.
