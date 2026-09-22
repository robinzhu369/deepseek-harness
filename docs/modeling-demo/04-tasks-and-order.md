# 04 | Development Tasks, Dependencies, and Execution Order

English | [中文](04-tasks-and-order.zh.md)

## 4.1 Single Delivery Path

```text
T00 → T01 → T02 → T03 → T04 → T05 → T06   第一天：真实计算与 Agent 连接
                         ↓
T07 → T08 → T09 → T10 → T11 → T12 → T13   第二天：工作台、验收与交付
```

T07 may run in parallel with backend work after T02 freezes the API, but one developer follows the table order by default. Do not point multiple Codex Sessions at the same worktree to edit the same component or lockfile.

## 4.2 Task Table

The times below are implementation estimates: approximately 18 hours plus roughly two hours of buffer. Dependency installation, source builds, or unavailable models can change the duration.

| ID | Task | Minutes | Prerequisites | Acceptance threshold |
|---|---|---:|---|---|
| T00 | Repository and environment discovery | 60 | None | Confirm upstream commit, real extension points, model/build/test capability; tool smoke succeeds |
| T01 | Development Skills and browser tooling | 30 | T00 | Project Skills are discoverable; browser capability works or has an explicit blocker |
| T02 | Protocol, types, and state model | 60 | T00 | Plan/event schemas, Pydantic, and TS contracts agree; invalid-plan tests pass |
| T03 | Fixed Python Pipeline | 150 | T02 | Real cleaning, features, logistic regression, and artifacts complete without an LLM |
| T04 | Upload and Profile | 60 | T02 | Streaming upload, hash, data overview, preview, and invalid-CSV rejection |
| T05 | Task execution, approval, and persistence | 90 | T03, T04 | Idempotent confirmation, subprocess, timeout cancellation, refresh recovery, artifact index |
| T06 | Harness domain tools and Agent plan | 75 | T05 | Four tools, Skill snapshots, real LLM candidate plan, and human-confirmation loop |
| T07 | Theme and three-column skeleton | 75 | T01, T02 | #0F4C9E, icon navigation/buttons, independent scrolling, component-state demo |
| T08 | Business cards and task-panel integration | 105 | T06, T07 | Upload, plan, confirmation, run, real results/download coordinate across three columns |
| T09 | Lightweight business Skill management | 45 | T06, T08 | Four Skills support draft editing, validation, and snapshot publishing; versions remain isolated |
| T10 | Bounded workflow editing and rerun | 60 | T08 | Change parameters/optional features, invalidate downstream work correctly, create a new run |
| T11 | End-to-end and security regression | 75 | T09, T10 | Core E2E, unapproved-write rejection, error/cancel/restart, unauthorized-access checks |
| T12 | Screenshot review and fixes | 45 | T11 | Key resolutions/states have screenshots without clipping; icon names and focus pass |
| T13 | Deployment, re-verification, and demo delivery | 45 | T12 | Startup docs, pinned dependencies, real demo record, and unsupported-feature list |

## 4.3 Deliverables and Stop Points for Each Task

### T00: Mandatory Handoff Inspection

Run `git status --short` and `git rev-parse HEAD`; read applicable AGENTS/override files, package.json, the lockfile, upstream architecture, and relevant plugins. Confirm the real build, startup, typecheck, and test commands.

Produce `REPO_DISCOVERY.md`: main/subpackage directories, a tool-registration example, Session-context fields, Slot/chat-node examples, business Remote/upload/download mechanisms, icon system, and Python/browser/model connectivity. Use a minimal tool call for initial discovery and do not immediately edit the UI.

Preserve existing user changes; record only their impact and do not reset or clean them. Do not independently upgrade dependencies, replace frameworks, change databases, or alter network policy.

### T01: Install Only Essential Development Aids

Enable the six project Skills in this kit. Prefer existing browser capability or Playwright CLI; invoke external frontend-design or React review only when needed. Do not download over an unauthorized network. Review source and dependency installation separately; do not execute an unknown `curl | sh` command.

### T02: Write Failure Cases First

Build types from contracts and test missing fields, target leakage, invalid ratios, unknown operators, unapproved write tasks, and version conflicts. Freeze the API before assigning UI work. Confirm-and-run is not an LLM tool.

### T03: Produce Real Files First

Generate a small synthetic binary-classification CSV with a fixed seed and no network access. Include numeric and categorical fields, limited missing values, and a unique record ID. Implement the preprocessing and logistic-regression Pipeline and emit metrics plus data/model artifacts. Test that predictions load, feature names align, and fit observes training data only.

### T04: Upload Without Loading the File Into Memory

Save chunks, validate paths, and create a dataset ID/checksum; a Worker performs profiling. Report empty files, duplicate column names, and malformed formats clearly. A Profile must not turn one million rows into LLM context.

### T05: Make State Traceable

Record queued, running, and terminal states in the business database. Workers emit events; cancellation terminates the process group; artifacts complete atomically; restart marks interrupted work. Add idempotency keys, plan versions, and Session-authorization checks. Do not build a fake task system that exists only in memory.

### T06: Connect Only to a Verified Compute Service

Add the four domain tools and result parsing, load four runtime business Skills, and render a candidate plan card. Verify one real model path from tool → plan → user confirmation → run. If the model fails, show the failure instead of silently substituting a fixed plan.

### T07: Build a Reviewable Interface First

Use the UI document and reference HTML to implement tokens, navigation, three columns, Composer, and the empty state first. Keep fixtures separate and label them "UI demo data." Reuse the upstream component system and do not create another application. Capture 1440 and 1366 screenshots.

### T08: Connect One Complete Vertical Flow

Replace fixtures with the real API in sequence. Dataset cards, plan cards, task state, and results all read one ModelingClientModel. Confirm that double-clicking, switching Sessions, refreshing, and out-of-order polling do not create duplicate tasks or cross-Session state. Result values come from metrics.json.

### T09: Deliver the Minimum Visible Custom-Skill Path

Provide a list and textarea editor, draft saving, validation, and version publishing. Run one schema smoke when publishing; do not build a complete Skill-evaluation platform in these 45 minutes. If implementation time expires, retain the minimal file-editing and publish-button path and list the missing UI in delivery notes.

### T10: Parameter Editing Is Not an Arbitrary DAG

Expose only valid parameters from the capability list and require splitting before fitting. Model-parameter changes create a new run and confirm reused objects by hash. Cleaning or feature changes rerun their downstream work. Recompute when no valid cache exists; do not claim reuse.

### T11: Evidence Precedes "Complete"

Run core tests and complete one real upload-to-download flow. Test cancellation, errors, restart, and unauthorized access separately. Run upstream-required checks for the changed scope. State when repository-wide checks were not run; do not weaken upstream rules to pass.

### T12: Screenshot → Problem → Fix → New Screenshot

Fix clipping, overflow, and layout before icons, copy, and spacing. Preserve the post-fix screenshot and viewport. Compare the reference structure and blue theme without pixel-copying the original brand.

### T13: Fix Only Blocking Issues at the End

Record reproducible startup commands, the model configuration entry point, demo-data seed, software versions, tests actually run, and unsupported capabilities. A capacity test records its own duration and memory report; use NOT_RUN when it was not run. Do not add a full DAG, Notebook, or Multi-Agent implementation in the final hour.

## 4.4 Stage Gates

G0: Upstream starts and the custom-tool smoke succeeds. Do not begin large UI changes before it passes.

G1: The compute path completes and exports real files without an LLM. Do not fill the UI with hardcoded results before it passes.

G2: A real Agent candidate plan, human confirmation, and isolated execution succeed. Do not call the feature an Agent loop before it passes.

G3: The full three-column UI flow, refresh recovery, important failures, and screenshots at two desktop viewports pass.

G4: The delivery is reproducible and distinguishes implemented behavior, UI-only behavior, and unimplemented behavior.

## 4.5 Removable and Required Scope

Remove first: second model, complex charts, SHAP, arbitrary DAG, online Notebook, Skill store, and animation.

Do not remove: real computation, target/split correctness, confirmation authority, plan versions, real task state, file downloads, the #0F4C9E theme, a usable three-column interface, and minimum test evidence.
