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

Attempt failures use an allowlisted structured envelope and a durable journal entry before container teardown. Recovery preserves the original classification while cancellation and attempt fencing retain precedence. Platform-specific offline bundles contain runtime dependencies and fixed image exports; immutable release directories and explicit compatibility checks support stopped-service rollback. Quiescent snapshots bind PostgreSQL, object bytes and Harness history, excluding named credential files. Local synthetic recovery does not establish target RPO/RTO, enterprise network policy or business approval.

The guided workbench prioritizes upload, goal and proposal review, folding technical controls and displaying published quality reports. CSV header discovery fills the complete feature-role map while keeping label and identifier choices explicit. Import snapshots expose bounded Worker failure codes. Web message submission acknowledges acceptance; the existing Harness interval remains tracked through idle, persistence and disposal, with concurrent submissions rejected. Local Ollama validation uses the existing configurable compatibility endpoint and a 32K context alias of the installed Qwen 9B weights; it does not establish Skill business acceptance.

Shared workbench model profiles reuse llm-pi-ai, settings revision checks and write-only credentials rather than introduce a parallel LLM client. Task creation resolves and locks the selected provider/model identity, including Skill invocation metadata; endpoint and key updates remain live. Connectivity uses a tool-free logged synthetic agent session and a non-human message source to avoid automatic title requests. The initial configuration button remains protected by the Harness carrier; phase one intentionally adds no separate administrator role. Protocol tests use a local synthetic server and never transmit the fraud dataset to public endpoints.

## Alternatives considered

**Conversation state as the job database.** Conversation cancellation and data computation have different lifetimes; data state requires its own transactions and artifact references.

**In-memory queue acceptance.** Such tests cannot establish lease recovery or atomic cursor behavior. Integration tests use a disposable real PostgreSQL instance.

**Standalone replacement UI.** A separate mock application would not verify the required Harness extension points. UI integration stays dependent on the authenticated business adapters.

## Acceptance criteria

All six P0 requirements and 54 acceptance scenarios remain in the [ledger](../../../../implementation/acceptance.json). A component test or compute benchmark is insufficient for product release. The source packages require actual Skill evaluation and release before model use.

## Risks

The source extension uses the root pnpm lockfile but remains outside the upstream release build closure. Container tests establish local kernel isolation, not target infrastructure acceptance. Business-labelled Skill evaluation, enterprise authentication and target storage/network/recovery configuration remain unavailable. Local offline and recovery evidence is recorded in the T15 report. The active-note supersession search found no existing data-agent decision to replace.

## Conversation-first workbench

The optional workbench keeps data attachment in the main task flow and opens monitoring only on demand. Code, artifacts and context separate technical evidence from conversation; approval cards remain visible because hiding required decisions would block safe execution. Search includes the original goal so renaming does not remove discoverability. Real Web regression covers monitor visibility, immutable history, approvals and layout restoration.

History management now exposes owner-scoped rename and deletion in the sidebar. Deletion retains execution artifacts and audit files and refuses active work. Goal drafting uses a separate tool-free Harness session with logged keyword/language input and the selected model; generated text remains editable and never submits work automatically.

Model setup now provides confirmed profile deletion, generated IDs, collapsed advanced fields and save-and-test. Deletion uses the existing Settings revision check and does not revoke API keys; a deployment-owned profile cannot be removed by deleting a user override. Browser regression covers save/test, cancel/delete, and persistence after reopening.

Modeling acceptance adds strict numeric casting and explicit missing-token replacement because CSV imports may retain string types. Protected roles remain immutable. Run tools omit large metadata by default and expose it on request; this bounds routine polling output without discarding persisted evidence. The real DeepSeek trial required manual corrections to transform nodes and stage lineage; context overflow prevented autonomous export planning. The reviewed export was completed locally. See [acceptance results](../../../../implementation/modeling-acceptance-2026-09-18.md).

Feature-engineering 0.2.0 incorporates the pinned MIT-licensed AI-SKILLS method into the existing Skill ID rather than creating a second feature planner. The main instructions remain self-contained, and upstream text plus attribution travel as locked resources. Declared operator dependencies reject incompatible runtimes. Package validation exercises all references, immutable snapshots and missing dependencies; it does not establish model planning quality or business release eligibility.

Data attachment uses a project-scoped, searchable and paginated card dialog with an upload subview. Selection remains local until confirmation; cancellation preserves the mounted dataset and goal draft. Only ready imports are mountable. The landing composer shows the mounted filename with replace/remove actions; the full Data Center retains inspection and archival controls. No virtual folders or unsupported sources are displayed.
