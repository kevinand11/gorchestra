# Core Package DOX

## Purpose

The `libs/core/` package is the private Core package source surface for reusable Portfolio-level orchestration contracts and runtime boundary behavior.

## Ownership

- `src/domain/` owns Core package domain models, reusable domain pipes, reusable read-model value pipes, and shared primitives; domain files do not own operation input pipes. `src/domain/index.ts` is the runtime namespace index for public `Domain.*` type and pipe exports.
- `src/commands/` owns command construction, command implementations, and command contract types; keep most Core commands as one file with its source test, input pipe/type, `Input`, `Result`, `Error`, and `Operation` types in that same file. Large commands may use a command folder with `index.ts` owning the public operation contract and focused helper files such as `handlers/*`, validation, materialization, or reference-resolution modules owning their local behavior/tests. Let `src/commands/index.ts` assemble commands and derive `Commands.Core` for `openCore`.
- `src/queries/` owns query construction, query implementations, and public query contract pipes/types; keep one Core query per file with its source test, exported object `inputPipe`, exported success-payload `resultPipe`, `Input`, `Result`, `Error`, and `Operation` types in that same file. `src/queries/index.ts` is the runtime namespace index for public `Queries.*` query contracts; query runtime assembly lives in `src/queries/create-core-queries.ts` and is imported directly by Core opening code rather than exported from the public `Queries` namespace.
- `src/snapshots/` owns Snapshot operation construction, implementations, and contract types; keep one Snapshot operation per file with its source test, input pipe/type, `Input`, `Result`, `Error`, and `Operation` types in that same file, and let `src/snapshots/index.ts` assemble Snapshot operations and derive `Snapshots.Core` for `openCore`.
- `src/core.ts`, `src/runtime.ts`, `src/services.ts`, `src/providers/`, `src/errors.ts`, and `src/validation.ts` own the remaining split Core API concerns: Core runtime opening/preflight, internal runtime assembly, Core Services contracts, internal Core Provider contracts/assembly, validation, and error contracts.
- `src/storage/` owns internal Equipped storage schemas, Repo helpers, and Core storage migration definitions; Core accepts an already Portfolio-scoped Equipped Repo as `CoreServices.storage` and must not reintroduce a custom storage service/table transaction façade.
- `src/utils/` owns internal shared utilities, including `utils/types.ts` for shared public primitive types such as `Result`, `utils/storage.ts` for generic Core runtime helpers, `utils/command.ts` for generic command handler builders, `utils/command-storage.ts` for command-oriented domain helpers, `utils/command-errors.ts` for shared command helper error aliases, `utils/test-helpers.ts` for source-test helpers, `utils/delivery-preflight.ts` for shared provider-backed Delivery preflight check aggregation, and `utils/delivery-context/` for Delivery Context loading, Delivery Work Resolution, context contracts, and pure Delivery/Slice Work State derivation from Delivery Context.
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
- Opened Core exposes top-level `preflight()` for required Core Service readiness; keep it separate from command/query APIs and do not include optional logger/event checks.
- Storage-backed Secret and Secret Binding mutations must preserve Archive Period history and enforce duplicate exact binding scope/environment names across archived and active bindings.
- Secret read queries return redacted Secret data with Secret References for Repository access, Secret Binding, and Model Provider usages; they must never expose plaintext or Protected Secret Value References.

## Work Guidance

- Keep `src/domain/*` files focused by domain entity or shared domain primitive; put reusable cross-domain shapes in `src/domain/commons.ts`.
- Keep the split Core API modules focused by concern; `index.ts` owns the small public package barrel.
- Keep operation files focused on one runtime API method each; define operation input pipes file-local unless another module needs them. Operation files export generic contract type names (`Input`, `Result`, `Error`, `Operation`) and their indexes expose PascalCase type namespaces such as `Commands.CreateProject`, `Queries.ListProjects`, and `Snapshots.Restore`. Put behavior tests in the source file that owns the behavior rather than testing it through the public API barrel. Keep reusable derivation logic such as Delivery/Slice Work State in focused internal utilities rather than duplicating it in operation files.
- Use the filtered `listRecords` storage utility for scoped reads before applying in-memory predicates; package-wide scans should be reserved for operations that genuinely need the full Portfolio resource set.
- Keep command files focused on one `Commands.Core` method each. Share only genuinely reusable command helpers through `src/utils/command*.ts`; command folders should own operation-specific helper modules, not cross-command utilities. `createPlan` creates the Plan and its Planning Agent Run in one transaction after resolving a selectable Planning Model. `createMemory` creates one raw Memory and optional deduped `supersedes` Links atomically; its v1 command input uses a future-shaped Links array but accepts only `supersedes` variants. `createLink` and `archiveLink` are Portfolio graph commands; v1 standalone Link creation is limited to Memory-to-Memory `references`, `supports`, `contradicts`, and `supersedes`, while archiving is limited to `references`, `supports`, and `contradicts` per Link immutability rules.
- Commands and queries should use small internal Equipped Repo helpers for storage operations rather than a `CoreStorageTransaction` façade or raw repeated query-builder/error-mapping boilerplate.
- `src/commands/run-delivery-work/preflight.ts` owns command-local scheduler preflight orchestration around Delivery Context reads, provider-backed checks, and failed `validate-preflight` Action writes; keep generic readiness primitives in `src/utils/delivery-preflight.ts`.
- Artifact creation provider calls and result writes belong in the `*-needs-artifact-creation` handlers; Review Surface creation provider calls and result writes belong in the `*-needs-review-surface` handlers; Artifact validation writes belong in the matching validation handlers and are dispatched through normal Delivery/Slice Work State handling.
- Use `withTwoPhaseTransaction` from `src/utils/storage.ts` for command flows that intentionally split read-claim, outside-transaction work, and write phases.
- Source Control Provider operation call sites should use the family façade on `runtime.providers.sourceControl`; provider-specific dispatch, provider-specific Secret value resolution, and provider-named readiness summaries belong in `src/providers/source-control/`, while concrete provider files own external SDK behavior.
- Model Provider Protocol operation call sites should use the family façade on `runtime.providers.modelProviderProtocols`; protocol dispatch, Model Provider Secret value resolution, and protocol-named readiness summaries belong in `src/providers/model-provider-protocol/`, while concrete protocol files own external SDK behavior.
- Keep query files focused on one `Queries.Core` method each and use object inputs rather than positional arguments for public query calls. Query files export `inputPipe` for Core input validation and `resultPipe` for the unwrapped successful value consumers may reuse as response validation. Memory records and Proposed Memories require a concrete Memory Type; Core does not support null or Uncategorized Memory types. Memory read models include `status: 'current' | 'superseded'` derived from `supersedes` Links plus all direct Links touching the Memory, including archived Links. Project-scoped Plan and Delivery reads validate the Project boundary before returning data; Plan read models include the required Planning Agent Run, and missing or duplicate Planning Agent Runs are invariant violations. Delivery read models may expand target Repository and Slice data needed by consumers while preserving stored Delivery lifecycle fields.
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
