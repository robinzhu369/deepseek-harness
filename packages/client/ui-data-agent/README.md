---
description: "Three-column Data Agent workbench for the Harness Web profile."
kind: "package-reference"
---

# @deepseek-ai/dsh-client-ui-data-agent

English | [中文](README.zh.md)

## Summary

The optional plugin occupies the sidebar, a keyed main panel, the rightbar and a manager overlay. React Flow renders versioned workflows; PostgreSQL and the Harness session log remain authoritative.

## Table of Contents

- [Use this package](#use-this-package)
- [Understand the implementation](#understand-the-implementation)
- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)
- [Dev Note](#dev-note)

## Use this package

Mount through the [source overlay](../../../deploy/data-agent/workbench.source.patch.yml) after the Web profile. Configure the domain host and loopback endpoint explicitly. The shipped Web profile leaves this plugin disabled.

The Host controller configuration requires `pollIntervalMs` (at least 1000) and `maxUploadBytes` (positive integer). Browser credentials remain in memory; reload requires signing in again. View choices and workflow drafts persist locally per actor.


## Understand the implementation

The three columns share a registered view store and a React-free model injected through framework hooks. Reads are fenced by account and request generation. Historical Run snapshots are read-only; copying one creates a separate workflow identity. Saving or proposing a changed workflow does not preserve approval.

The landing page centers a goal composer over a subtle grid, with data attachment and selection in its toolbar. Suggested tasks fill the goal without submitting it; AI goal generation and advanced settings stay collapsed. The sidebar groups labeled icon navigation, project selection and task history, with pagination only when needed. A ready dataset and nonempty goal remain required to create a task. CSV imports discover complete, unique headers from a bounded 64 KiB prefix; unspecified columns become features, while label and identifier fields remain explicit. Values stay as text unless advanced options declare types. Parquet and headerless CSV require complete roles in advanced settings. Import failures expose the Worker error code. Ready datasets lead directly to task creation. Tool details and execution controls are folded; published quality reports expose row, column, duplicate and field counts. Messages acknowledge acceptance while authoritative history continues to update. The data manager submits resumable verified uploads, immutable imports and bounded preview jobs. Skill commands use the backend lifecycle gates. Model cancellation, Run cancellation and business-task cancellation are separate operations.


Skill stage entries display the default version and latest evaluation; selecting a version creates a fresh planning session and still requires proposal review. Draft evidence can retain an existing proposal’s published references. Drag the existing frame separators, then use Save column widths to retain the layout across reloads.

Navigation pairs shared line icons with localized labels. Compact search, send, history-edit and monitor-header actions expose localized accessible names and hover titles. Monitor selection uses the workbench selected-background token; button variants retain ownership of their foreground colors.

<a id="dev-note"></a>

### Dev Note

No runtime invariant companion is published: this consumer owns no independently persisted execution state to reconcile. Model race tests, graph checks and the real Web composition regression own its verification.

## Model Experience

### Domain interaction

#### What the model sees

None directly. This package presents or transports `/v1/data/` requests; the domain Harness integration owns model context and tool execution.

#### Token effect

The package adds no tokens. Explicitly submitted session messages are rendered by the domain integration.

#### KV Cache effect

No direct effect. A submitted message extends the underlying conversation through its existing owner.

## Known Limitations and Deferred Work

- The UI polls authoritative snapshots and displays pending sync after read failures. Cold sessions require explicit resume. Navigation retains at most 200 Runs and proposals; event rendering shows the latest 200 loaded records. Upload hashing buffers one file up to the configured browser limit. Advanced operator parameters and Skill packages use JSON editors.

The homepage exposes shared model configuration below Connect workbench, before domain sign-in. One named model profile holds a Chat Completions-compatible official, relay or self-hosted endpoint, a write-only credential reference, reasoning dialect/effort, context capacity, output cap and timeout in the existing llm-pi-ai settings namespace. Saved profiles are revision-fenced; keys are never read back and blank edits retain them. A test submits a synthetic tool-free Harness request and reports safe status, not business quality. New tasks may select a registered provider/model; existing tasks keep their model identity while later shared endpoint/credential changes still apply. Phase one adds no administrator/user role separation.

The workbench starts with the monitor hidden. Navigation reserves separate space for actions and searchable, paginated history. Conversations show messages and approval cards; Code contains workflow definitions and tool records, Artifacts contains reports and downloads, and Context contains input, model, versions and execution controls. Creating a task sends its goal immediately; a failed send retains the session for retry. Templates reuse workflows without carrying approval. Session search matches both the title and original goal.

Task history exposes inline rename and confirmed deletion. Deletion removes the owned history binding; datasets, run outputs and audit logs remain, and active runs or conversations block deletion. The new-task goal editor supports an example, direct AI drafting, or keyword-based drafting using the selected model. Drafting runs through a tool-free, logged Harness session and never creates a business task or reads dataset rows; failed generation preserves the existing draft.

The model dialog generates configuration IDs, folds advanced parameters by default, supplies a placeholder key for new local Ollama configurations, and offers one-step save-and-test. Confirmed deletion removes one workbench provider through revision-fenced Settings mutation; history and credential references remain, and dependent tasks can no longer call the removed route. Deployment-owned profiles that reappear after removing a user override are reported explicitly. New-task model selections clear when their route disappears.
