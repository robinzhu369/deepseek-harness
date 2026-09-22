---
description: "Configure the bounded ModelX Host adapter, four modeling tools, human approval Remote, and isolated runtime Skills for the deterministic modeling demo."
kind: "package-reference"
---

# @deepseek-ai/dsh-experimental-modeling

English | [中文](README.zh.md)

## Summary

Use this package to let a dedicated Agent read dataset profiles, propose validated plans, and inspect run status and results without gaining execution authority. The application approves an exact plan revision or requests a rerun through separate Remote methods. The included preset hides inherited general-purpose tools and loads only five runtime modeling Skills. The Host sends its live Session identity to the private modeling API and removes internal paths and process fields from model-visible results. Its Session-scoped browser model restores workspace and run history, owns one revision-aware polling loop, and downloads completed files through artifact IDs.

## Table of Contents

- [Use this package](#use-this-package)
- [Understand the implementation](#understand-the-implementation)
- [Further Exploration](#further-exploration)
- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)
- [Dev Note](#dev-note)

-----

<a id="use-this-package"></a>
## Use this package

Build the package, apply [`modeling.patch.yml`](modeling.patch.yml) after the Web bundle, set `MODELING_API_URL` for the Host process, and select the included `modeling` preset. The source-local patch resolves this checkout's built files by URL.

### When to choose it

The Skill center displays localized names, capability summaries, and input/process/output guides for the five built-in Skills. These guides are not translations of immutable published revisions. Expand the original-instructions editor to inspect or modify the actual `SKILL.md`; display localization does not publish a new Skill version.

Choose this package for the bounded ModelX demo workflow backed by `services/modeling-api`. Use an ordinary coding preset when an Agent needs shell, filesystem mutation, arbitrary HTTP, SQL, or Python execution; those capabilities are deliberately absent here.

### Minimal configuration

The Host service requires explicit deployment values:

```yaml
- name: '@deepseek-ai/dsh-experimental-modeling'
  config:
    baseUrl: http://127.0.0.1:8000
    requestTimeoutMs: 30000
    maxToolResultBytes: 12288
```

| Field | Default | Meaning |
|---|---|---|
| `baseUrl` | required | Private modeling API origin available to the Host |
| `requestTimeoutMs` | required | HTTP request timeout in milliseconds |
| `maxToolResultBytes` | required | Maximum UTF-8 size of one model-visible result |

The tools plugin separately requires `runtimeSkillDir`. The included preset points it at the repository `.dsh/skills` directory and configures `skill-filesystem` with `includeDefaultRoots: false`.

-----

<a id="understand-the-implementation"></a>
## Understand the implementation

<details>
<summary>Implementation internals — click to expand</summary>

`ModelingGateway` owns the configured private HTTP origin. The preset-local tools plugin streams direct-user CSV attachments from `ctx.attachments` into `/v1/datasets`, waits for profiling, and adds the returned dataset ID as durable model context. Tool calls derive the Session ID from the live `Agent`, while `approveAndRun` is a Typert Remote method that accepts the application caller's resolved `Agent`; no model tool exposes approval. The API validates dataset and run ownership against that Session ID.

The browser renders modeling proposal cards in the existing Chat timeline at their logged tool calls. Historical revisions remain read-only; the matching current revision shares one Session model for editing, approval, run status, metrics, and downloads. View details expands the full workbench inside the card. Completed artifacts show their service-relative Run directory, actual filename, purpose, and size while downloads continue to use opaque artifact IDs. The editor exposes the five-Skill sequence and executor-supported parameters; submitting edits queues an Agent turn that reuses matching profile evidence and proposes a new revision. Approval binds the displayed revision and hash, and the Host injects the API-returned run ID into the Agent's next request. Refresh never starts work. Cards remain visible when completed tool details collapse; only the current revision shows live execution details.

The Skill center lists the five fixed runtime Skills, edits a Session-private Markdown Draft, validates it, and publishes an immutable version. Its Contract, Schema, Tools, and Skill checks tabs read optional JSON files beside each `SKILL.md`; these tabs document Modeling extension metadata and configuration checks, not a separate Skill execution or evaluation runtime. The model-evaluation Skill reads actual completed-run results through `modeling_get_run_result`; it cannot retrain, tune, approve execution, or change a threshold. The Chat plan card owns the application-side `Confirm plan and run` button; sending a chat message does not approve a plan. The wide plan editor groups the bounded controls from `/v1/capabilities` into independently scrolling sections while its header and revision actions remain visible; it does not accept arbitrary JSON or DAG nodes. Editing an approved plan creates a proposed revision, and confirmation selects the previous terminal run as the source for an idempotent rerun with a new run ID.

The tools plugin hashes the exact bytes of the five versioned runtime Skills before registration and sends those snapshots only when it proposes a plan. Result projection removes internal paths, Session IDs, and worker process IDs, then applies the configured byte limit. The policy plugin masks inherited tools in the modeling preset scope.

| File | Role |
|---|---|
| [`src/index.ts`](src/index.ts) | Host HTTP adapter plus human approval and rerun Remotes |
| [`src/tools.ts`](src/tools.ts) | Four bounded model-facing tools and Skill snapshots |
| [`src/policy.ts`](src/policy.ts) | Scoped inherited-tool restriction |
| [`src/client/model.ts`](src/client/model.ts) | Session-scoped browser state, run history, idempotent confirmation, and polling |
| [`src/client/ModelingWorkspace.tsx`](src/client/ModelingWorkspace.tsx) | Full-width workbench cards, horizontal pipeline, and task presentation |
| [`src/client/SkillCenter.tsx`](src/client/SkillCenter.tsx) | Skill instructions plus Contract, Schema, Tools, and configuration-check tabs |
| [`presets/modeling/agent.cordis.yml`](presets/modeling/agent.cordis.yml) | Dedicated Agent composition and runtime Skill isolation |
| [`modeling.patch.yml`](modeling.patch.yml) | Source-checkout Host and preset wiring |

</details>

-----

<a id="further-exploration"></a>
## Further Exploration

- [Modeling API README](../../../services/modeling-api/README.md) — deterministic execution and persistence.
- [Agent preset package](../../preset/agent-presets/README.md) — scoped composition semantics.
- [Skill filesystem package](../../skill/skill-filesystem/README.md) — explicit Skill roots.
- [Generated tool catalog](../../../docs/tool-catalog.md#deepseek-aidsh-experimental-modeling) — the exact four modeling tool schemas.

-----

<a id="model-experience"></a>
## Model Experience

### Tool schemas and runtime Skills

#### What the model sees

The model sees `modeling_get_dataset_profile`, `modeling_propose_plan`, `modeling_get_run_status`, `modeling_get_run_result`, and the standard `skill` loader; the [generated tool catalog](../../../docs/tool-catalog.md#deepseek-aidsh-experimental-modeling) records their exact schemas. `modeling_propose_plan` accepts either a first proposal or an optimistic `plan_id` and `base_revision` pair for regeneration while retaining the same four-tool surface. A direct-user CSV attachment adds a durable application-produced dataset ID and SHA-256 to the same request; the filename remains an untrusted user label. The model receives aggregate profiles and bounded result summaries after it reads that ID. The included preset requires Simplified Chinese for user-facing replies while preserving tool, Skill, field, enum, and code identifiers. Plan proposals always return `needs_confirmation: true`; no approval, execution, shell, filesystem-write, SQL, Python, or arbitrary-network tool is visible.

#### Token effect

The four tool schemas and five Skill catalog entries add a fixed request prefix. Loaded Skill instructions and tool results append bounded text to Session history.

#### KV Cache effect

The prefix remains stable while the preset, runtime Skill bytes, and tool schemas are unchanged. Publishing a Skill version or changing the visible tools can invalidate reuse from the first changed entry.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>

These limits define the current source-local demo boundary.

- The current tool execution context exposes a trusted Session and workspace but no separate user identity; the Web Gateway launch-token cookie and Host/Origin checks establish the human boundary.
- The private API has no separate service-token mechanism, so deployments must keep `baseUrl` reachable only by the Host process.
- Result explanations require a configured real model provider; deterministic artifacts remain available if a later explanation fails.
- Only direct-user files whose names end in `.csv` enter the modeling dataset registry automatically; other attachment formats remain ordinary Harness attachments.
- The runtime Skill path in the included preset targets this source checkout and is not an installed-package data path.

No runtime invariant companion is published; the package projects each live Session directly from the Modeling API and retains no second mutable state source to compare.

<a id="dev-note"></a>
### Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

None.

</details>
