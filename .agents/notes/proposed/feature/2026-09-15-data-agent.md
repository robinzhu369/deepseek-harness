# Agent Note: Data preparation execution

Status: proposed

English | [中文](2026-09-15-data-agent.zh.md)

## Problem

The Harness conversation loop does not provide immutable dataset processing, train-only fitting, or durable data-job publication. Chat completion cannot establish that data is ready for training.

## Proposal

Keep data processing in a TypeScript domain service with PostgreSQL state and a Python Polars executor. The [development library](../../../../extensions/data-agent/README.md) exercises revisions, approvals, leases, candidates, and verified publication. A dsh source profile mounts the domain host. The authenticated Harness adapter provisions session identities, scoped tools and locked Skills; the existing React workspace remains a subsequent dependency.

The execution foundation also provides explicit import/quarantine policies, stateless business operators, persisted attempt credential hashes, and a host-mounted Worker HTTP handler. Worker credentials never select a caller-supplied project or attempt. A real Python deletion test exercises candidate isolation until impact approval.

The host registers its listener, serialized recovery work and database pool as one awaited Cordis effect. Startup failure propagates to dsh; disposal closes active requests before ending the pool. Loopback binding and exact Host validation require an internal TLS proxy for remote Workers. Real profile tests cover stalled requests and incompatible schema refusal.

The HTTP supervisor keeps credentials outside digest-pinned compute containers and journals attempts for restart recovery. Container network, filesystem and cgroup restrictions are verified against the running kernel. Immutable upload completion precedes queued import; cleanup excludes artifact references. Skill publication binds server-owned evaluation evidence to immutable package, suite and runtime digests, while invocation locks preserve historical snapshots across default changes and retirement.

The session adapter uses `AgentRegistry.create/resume` and awaited scoped plugin setup. PostgreSQL owns the actor/project binding and invocation locks; JSONL owns conversation history. The scoped loader accepts only those locks, so a global Skill or shell cannot expand the session's capabilities. Model responses remain ordinary logged tool calls. A real public DeepSeek smoke verifies diagnostic submission; a scripted external model verifies deterministic denial and process-restart replay without treating either as full Skill-quality evaluation.

Proposals and canvas edits share optimistic workflow transactions. Immutable proposal envelopes bind evidence, input versions, parameters and anticipated impact; authenticated decisions and frozen Run submission reuse the same transaction helpers. Candidate decisions bind actual manifests, and approval verifies object integrity again after the waiting interval. Agents cannot call decision routes through their tool set.

Synthetic quality evaluation compares baseline and candidate packages through isolated, persisted Harness Agents with identical tasks and model configuration. The complete output/workflow schemas accompany the prompt. Deterministic Python checks cover frozen computation independently. A missing workflow schema invalidated an initial development run; corrected holdouts use a distinct synthetic snapshot. Synthetic evidence is deliberately ineligible for business release, regardless of its pass rate.

Business tasks bind a published upload dataset to explicitly selected analysis, processing and feature Runs. PostgreSQL stores immutable predecessor/source links, scoped jobs and artifact reuse mappings. Task revisions serialize branching, selection and cancellation; a repeatable-read cursor vector projects the selected lineage without a second event authority. Cache admission verifies bytes and computation keys, retains original ArtifactVersions and excludes unpublished candidates. Frozen replay preserves Skill locks; a changed plan returns to proposal approval. Only a selected complete chain with a verified training export qualifies as completed. Boundary pauses preserve active execution, while task cancellation prevents later phase submission. The source-profile tool snapshot and actual Python/HTTP-container export tests exercise these paths.

The optional three-column workbench uses existing layout slots and an authenticated Remote adapter to the loopback domain host. Credentials remain in browser memory; view selections and drafts persist locally per actor. Historical Runs stay immutable and copied drafts require new proposals and decisions. Migration 008 owns session names and revisioned templates. The UI has no separate execution authority. The workbench retains saved column widths through the layout owner. Domain sessions narrow both prompt and tools so the general Web composition cannot add coding capabilities.

Planning quality includes execution of each valid generated DAG through the production Python executor. Independent row oracles detect changed legal values, labels, identifiers and incorrect derived values; frozen historical DAG checks remain separate. Historical model failures retain their original outcome. Evaluation Agents replace ambient system context to keep Web coding prompts and tools outside the evaluation. Synthetic suites cannot establish human business acceptance.

CSV null policy precedes declared type conversion. An explicit empty-string marker produces null, while an unspecified empty field remains a legal string. Browser-to-container import coverage and a direct parser regression enforce both cases.

Shared upload/download routes must not attach a stream to a GET or HEAD Fetch request. The Connection bridge uses its bounded bodyless path for those methods, while POST retains streaming backpressure. A browser download and method-specific regressions verify delivery.

Capacity evidence binds generated input digests to explicit container budgets and the real Web/Worker path. Independent full-row checks recompute train-only statistics and feature values. Scripted planning, automated approval, cached reads and sampled resource peaks retain separate measurement labels. Boundary failures remain failures; local success does not establish target infrastructure capacity or business release.

The Web integration packages follow the ordinary workspace release metadata and restrict packed Client files to bundled entrypoints and declarations. The domain extension remains private. Frozen requirement and command-log files retain original whitespace for digest and measurement provenance; executable source retains the normal whitespace checks.

## Alternatives considered

**Conversation state as the job database.** Conversation cancellation and data computation have different lifetimes; data state requires its own transactions and artifact references.

**In-memory queue acceptance.** Such tests cannot establish lease recovery or atomic cursor behavior. Integration tests use a disposable real PostgreSQL instance.

**Standalone replacement UI.** A separate mock application would not verify the required Harness extension points. UI integration stays dependent on the authenticated business adapters.

## Acceptance criteria

All six P0 requirements and 54 acceptance scenarios remain in the [ledger](../../../../implementation/acceptance.json). A component test or compute benchmark is insufficient for product release. The source packages require actual Skill evaluation and release before model use.

## Risks

The source extension uses the root pnpm lockfile but remains outside the upstream release build closure. Container tests establish local kernel isolation, not target infrastructure acceptance. Business-labelled Skill evaluation, enterprise authentication, storage ingress, offline artifacts and restoration environment remain unconfigured. The active-note supersession search found no existing data-agent decision to replace.
