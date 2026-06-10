# Core Package DOX

## Purpose

The `libs/core/` package is the private Core package source surface for reusable Portfolio-level orchestration contracts and runtime boundary behavior.

## Ownership

- `src/model.ts` owns the current Core package domain model types.
- `src/api.ts` owns the public Core API barrel.
- `src/commands.ts`, `src/queries.ts`, `src/core.ts`, `src/services.ts`, `src/errors.ts`, `src/boundary-pipes.ts`, `src/validation.ts`, and `src/result.ts` own the split Core API concerns, Core Services/runtime boundary direction, validation, implemented Secret, Model Provider, Model, and Portfolio Config commands, and remaining stubs.
- `src/index.ts` owns package exports.
- `vitest.config.ts` owns package-local test discovery, including source tests through `import.meta.vitest`.

## Local Contracts

- Before changing domain shapes or API semantics, read `../../docs/core/CONTEXT.md` and relevant ADRs in `../../docs/core/adr/`.
- Keep package source and Core documentation synchronized when a change affects both durable domain language and source contracts.
- Source tests may use `import.meta.vitest`; test-only APIs should stay scoped inside the `if (import.meta.vitest)` block.
- Consumer-facing API inputs should prefer identifiers and let Core infer authoritative fields instead of accepting duplicated inferable values.
- Durable Core docs/ADRs define Core-owned provider behavior and consumer-provided Core Services; do not add new consumer-owned behavior ports.
- Core-owned provider/runtime behavior and Core Service calls that perform external actions should receive resolved values needed to perform the action so service/provider code does not infer authoritative context itself.
- Opened Core exposes top-level `preflight()` for required Core Service readiness; keep it separate from command/query APIs and do not include optional logger/event checks.
- Storage-backed Secret and Secret Binding mutations must preserve Archive Period history and enforce duplicate exact binding scope/environment names across archived and active bindings.

## Work Guidance

- Keep `model.ts` focused on data shapes and domain records.
- Keep the split Core API modules focused by concern; `api.ts` should remain a small public barrel.
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
