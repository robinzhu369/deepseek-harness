---
description: "Authenticated Web Remote adapter for the Data Agent domain host."
kind: "package-reference"
---

# @deepseek-ai/dsh-api-data-agent-controller

English | [中文](README.zh.md)

## Summary

The optional service forwards bounded JSON commands and binary transfers through the existing Harness browser carrier. The domain host authenticates the user credential and checks project membership for every operation.

## Table of Contents

- [Use this package](#use-this-package)
- [Understand the implementation](#understand-the-implementation)
- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)
- [Dev Note](#dev-note)

## Use this package

Mount the service with the [workbench source overlay](../../../deploy/data-agent/workbench.source.patch.yml). The browser also requires its own Harness connection authorization. A domain credential alone cannot bypass the carrier.

Required configuration: `endpoint` is an exact `http://127.0.0.1:port` origin; `timeoutMs`, `maxBodyBytes` and `maxResultBytes` are positive limits; `pollIntervalMs` and `maxUploadBytes` bound browser polling and upload buffers. Only `/v1/data/` JSON paths are accepted. Redirects are rejected.


## Understand the implementation

The generated `dataAgent.request` Remote preserves the domain HTTP status and JSON body. The exact `/api/data-agent/bytes` Fetch route permits only upload parts and artifact downloads; caller-selected arbitrary proxy targets are unavailable.

Credentials travel in Remote parameters or the binary credential header and are never persisted by this adapter. The domain host owns upload size, ticket, digest and authorization enforcement.


<a id="dev-note"></a>

### Dev Note

No runtime invariant companion is published: the adapter owns no independent domain state. The domain repository and connection carrier enforce authority; request and disposal tests cover forwarding.

## Model Experience

### Domain interaction

#### What the model sees

None directly. This package presents or transports `/v1/data/` requests; the domain Harness integration owns model context and tool execution.

#### Token effect

The package adds no tokens. Explicitly submitted session messages are rendered by the domain integration.

#### KV Cache effect

No direct effect. A submitted message extends the underlying conversation through its existing owner.

## Known Limitations and Deferred Work

- The domain host must run on the same machine. Accepted business commands may finish after a browser disconnect; clients reconcile snapshots rather than assuming cancellation or retrying writes automatically.
