# Core Package DOX

## Purpose

The `libs/core/` package is the private Core package source surface for reusable Portfolio-level orchestration contracts and runtime boundary behavior.

## Ownership

- `src/domain/` owns Core package domain models, reusable domain pipes, reusable read-model value pipes, and shared primitives; domain files do not own operation input pipes. `src/domain/proposals.ts` owns shared Plan and Revision output proposal pipes used by Plan, Revision, and Agent Run Event transcript records. `src/domain/index.ts` is the runtime namespace index for public `Domain.*` type and pipe exports.
- `src/commands/` owns command construction, command implementations, and command contract types; keep most Core commands as one file with its source test, input pipe/type, `Input`, `Result`, `Error`, and `Operation` types in that same file. Large commands may use a command folder with `index.ts` owning the public operation contract and focused helper files such as `handlers/*`, validation, materialization, or reference-resolution modules owning their local behavior/tests. Let `src/commands/index.ts` assemble commands and derive `Commands.Core` for `openCore`.
- `src/queries/` owns query construction, query implementations, and public query contract pipes/types; keep one Core query per file with its source test, exported object `inputPipe`, exported success-payload `resultPipe`, `Input`, `Result`, `Error`, and `Operation` types in that same file. `src/queries/index.ts` is the runtime namespace index for public `Queries.*` query contracts; query runtime assembly lives in `src/queries/create-core-queries.ts` and is imported directly by Core opening code rather than exported from the public `Queries` namespace.
- `src/snapshots/` owns Snapshot operation construction, implementations, and contract types; keep one Snapshot operation per file with its source test, input pipe/type, `Input`, `Result`, `Error`, and `Operation` types in that same file, and let `src/snapshots/index.ts` assemble Snapshot operations and derive `Snapshots.Core` for `openCore`.
- `src/core.ts`, `src/runtime/index.ts`, `src/runtime/agent-runs/instructions.ts`, `src/services.ts`, `src/providers/`, `src/errors.ts`, and `src/validation.ts` own the remaining split Core API concerns: Core runtime opening/preflight, internal runtime assembly, Core-owned Agent Run instruction builders, Core Services contracts, internal Core Provider contracts/assembly, validation, and error contracts.
- `src/work/` owns Core Work operation construction, operation contracts, and Consumer-runtime invoked write operations such as model AgentRun advancement and Delivery work processing.
- `src/storage/` owns internal Equipped storage schemas, Repo helpers, and Core storage migration definitions; Core accepts an already Portfolio-scoped Equipped Repo as `CoreServices.storage` and must not reintroduce a custom storage service/table transaction façade.
- `src/utils/` owns internal shared utilities, including `utils/types.ts` for shared public primitive types such as `Result`, `utils/agent-run-events.ts` for Agent Run Event append and Model Agent Run creation helpers, `utils/agent-run-targets.ts` for Interactive Agent Run target validation, `utils/agent-runs.ts` for Agent Run lookup/completion helpers, `utils/storage.ts` for generic Core runtime helpers, `utils/command.ts` for generic command handler builders, `utils/command-storage.ts` for command-oriented domain helpers, `utils/command-errors.ts` for shared command helper error aliases, `utils/test-helpers.ts` for source-test helpers, `utils/delivery-preflight.ts` for shared provider-backed Delivery preflight check aggregation, and `utils/delivery-context/` for Delivery Context loading, Delivery Work Resolution, context contracts, and pure Delivery/Slice Work State derivation from Delivery Context.
- `src/index.ts` owns the public Core API barrel and exports operation/domain contract families through type-only namespaces.
- `vitest.config.ts` owns package-local test discovery, including source tests through `import.meta.vitest`.

## Local Contracts

- Before changing domain shapes or API semantics, read `../../docs/core/CONTEXT.md` and relevant ADRs in `../../docs/core/adr/`.
- Keep package source and Core documentation synchronized when a change affects both durable domain language and source contracts.
- Source tests may use `import.meta.vitest`; test-only APIs should stay scoped inside the `if (import.meta.vitest)` block.
- Do not add Vitest test blocks whose only purpose is to assert static TypeScript types; project-reference typechecking already verifies type contracts.
- Consumer-facing API inputs should prefer identifiers and let Core infer authoritative fields instead of accepting duplicated inferable values.
- Core-owned identifiers use `src/domain/commons.ts` as the source of truth for `Id` and `idPipe`; keep domain-specific field names and do not add resource-specific ID aliases.
- For every domain model, reusable read model, operation input shape, or operation success result shape with a runtime pipe, define the pipe as the source of truth and infer the exported type with `PipeOutput<typeof pipe>`; do not duplicate that shape with a handwritten interface/type.
- Durable Core docs/ADRs define Core-owned provider behavior and consumer-provided Core Services; do not add new consumer-owned behavior ports.
- Core provider families receive `CoreServices` at runtime assembly and may own family-level dispatch and service-backed resolution; concrete external provider implementations should receive resolved values needed to perform the external action and should not load authoritative context themselves.
- Sandbox Provider public service contracts are raw provider contracts; keep runtime environment store semantics, `setEnv`, Secret redaction, output truncation, summary normalization, validation, and best-effort release wiping inside `src/runtime/sandboxes/managed.ts` rather than raw Vercel or Consumer-managed adapters.
- `AgentRun.sandbox === null` means no sandbox has been successfully created and recorded; non-null Agent Run sandbox state must include created lifecycle evidence and must not use nullable `created` as a preparation state marker.
- Opened Core exposes top-level `preflight()` for required Core Service readiness; keep it separate from command/query APIs and do not include optional logger/event checks.
- Core storage transactions created with `withTransaction` roll back on returned error `Result`s as well as thrown exceptions; expected domain, boundary, and service-output failures should return `Result` variants rather than throwing only to abort a transaction.
- Core dispatcher service acceptance uses `request(input): Promise<string>` to return an opaque marker inside command/work transactions and `ready(marker): void` only after successful transaction completion; command and work implementations must not start dispatch processing inside the transaction. Core dispatch requests carry Dispatch Coordination Claims that Consumers must scope by Portfolio namespace and acquire before processing.
- Storage-backed Secret mutations must preserve Archive Period history.
- Secret read queries return redacted Secret data with Secret References for Repository access, Agent Run Profile runtime requirements, and Model Provider usages; they must never expose plaintext or Protected Secret Value References.

## Work Guidance

- Keep `src/domain/*` files focused by domain entity or shared domain primitive; put reusable cross-domain shapes in `src/domain/commons.ts`.
- Keep the split Core API modules focused by concern; `index.ts` owns the small public package barrel.
- Keep operation files focused on one runtime API method each; define operation input pipes file-local unless another module needs them. Operation files export generic contract type names (`Input`, `Result`, `Error`, `Operation`) and their indexes expose PascalCase type namespaces such as `Commands.CreateProject`, `Queries.ListProjects`, and `Snapshots.Restore`. Put behavior tests in the source file that owns the behavior rather than testing it through the public API barrel. Keep reusable derivation logic such as Delivery/Slice Work State in focused internal utilities rather than duplicating it in operation files.
- Use the filtered `listRecords` storage utility for scoped reads before applying in-memory predicates; package-wide scans should be reserved for operations that genuinely need the full Portfolio resource set.
- Keep command files focused on one `Commands.Core` method each. Share only genuinely reusable command helpers through `src/utils/command*.ts`; command folders should own operation-specific helper modules, not cross-command utilities. `createPlan` creates the Plan and its Planning Agent Run in one transaction after validating and snapshotting the selected Agent Run Profile. `createMemory` creates a Memory and its initial MemoryRevision in one transaction. `createMemoryRevision` appends MemoryRevision history and atomically updates `Memory.currentRevision` after checking `expectedCurrentRevisionId`. Memory parent relationships are immutable after creation in this MVP; accepted Plan Output materialization and user-authored Memory Link commands are deferred.
- Commands and queries should use small internal Equipped Repo helpers for storage operations rather than a `CoreStorageTransaction` façade or raw repeated query-builder/error-mapping boilerplate.
- `src/work/schedule-delivery-work/` owns Delivery Work Scheduler Pass behavior: Delivery Context reads, local Delivery Work Resolution, failed local `validate-preflight` Action writes, and queuing concrete Delivery Work Operation dispatch requests. `src/work/process-delivery-work-operation/` owns concrete Delivery Work Operation processing and side-effecting Delivery/Slice handlers. `src/work/delivery-work/` owns shared Delivery work result types, dispatch Action builders, and operation descriptor helpers. Keep generic readiness primitives in `src/utils/delivery-preflight.ts`.
- Artifact creation provider calls and result writes belong in the `*-needs-artifact-creation` handlers; Review Surface creation provider calls and result writes belong in the `*-needs-review-surface` handlers; Artifact validation writes belong in the matching validation handlers and are dispatched through normal Delivery/Slice Work State handling.
- Use `withTwoPhaseTransaction` from `src/utils/storage.ts` for command flows that intentionally split read-claim, outside-transaction work, and write phases.
- Source Control Provider operation call sites should use the family façade on `runtime.providers.sourceControl`; provider-specific dispatch, provider-specific Secret value resolution, and provider-named readiness summaries belong in `src/providers/source-control/`, while concrete provider files own external SDK behavior.
- Model Provider Protocol operation call sites should use the family façade on `runtime.providers.modelProviderProtocols`; Model Provider Source-to-protocol dispatch, Model Provider Secret value resolution, AI SDK language-model resolution, provider-protocol thinking support validation, and protocol-named readiness summaries belong in `src/providers/model-provider-protocol/`, while Agent Run runtime owns AI SDK `streamText` turn execution, generic AI SDK reasoning selection, tool wrapping, live deltas, and transcript event persistence.
- Keep query files focused on one `Queries.Core` method each and use object inputs rather than positional arguments for public query calls. Query files export `inputPipe` for Core input validation and `resultPipe` for the unwrapped successful value consumers may reuse as response validation. Memory hierarchy reads use `listMemoryChildren({ parentId })` for direct children and `getMemory({ memoryId })` for one Memory with revisions and direct children. Core owns Memory child sorting by `currentRevision.title`, then id, and Memory revision sorting by newest `created.at`, then id. Project-scoped Plan and Delivery reads validate the Project boundary before returning data; Plan read models include the required Planning Agent Run, and missing or duplicate Planning Agent Runs are invariant violations. Delivery read models may expand target Repository and Slice data needed by consumers while preserving stored Delivery lifecycle fields.
- Keep Snapshot operations under `core.snapshots`; use `core.snapshots.export(input)` for creating a Snapshot from the currently-open Portfolio and `core.snapshots.restore(input)` for replacing the currently-open Portfolio contents.
- Core public APIs return `Result` for expected domain, boundary, dependency, provider, service, storage, and validation failures; do not throw for those cases.
- Preserve typed linting and type-only imports.
- Do not move tests to a root Vitest config; package tests belong to this package.

## Verification

- From repo root, run `pnpm --filter @gorchestra/core test` for Core package tests.
- From repo root, run `pnpm typecheck` for project-reference typechecking.
- From repo root, run `pnpm lint` for typed ESLint.
- From repo root, run `pnpm format` after source or package config changes.

## Child DOX Index

No child AGENTS.md files currently required.
