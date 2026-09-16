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

The data manager submits resumable verified uploads, immutable imports and bounded preview jobs. Skill commands use the backend lifecycle gates. Model cancellation, Run cancellation and business-task cancellation are separate operations.


Skill stage entries display the default version and latest evaluation; selecting a version creates a fresh planning session and still requires proposal review. Draft evidence can retain an existing proposal’s published references. Drag the existing frame separators, then use Save column widths to retain the layout across reloads.

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
