# Core Package DOX

## Purpose

The `libs/core/` package is the private Core package source surface for reusable Portfolio-level orchestration contracts and runtime boundary behavior.

## Ownership

- `src/model.ts` owns the current Core package domain model types.
- `src/api.ts` owns the current Core package API, ports, runtime boundary, validation, and stubs.
- `src/index.ts` owns package exports.
- `vitest.config.ts` owns package-local test discovery, including source tests through `import.meta.vitest`.

## Local Contracts

- Before changing domain shapes or API semantics, read `../../docs/core/CONTEXT.md` and relevant ADRs in `../../docs/core/adr/`.
- Keep package source and Core documentation synchronized when a change affects both durable domain language and source contracts.
- Source tests may use `import.meta.vitest`; test-only APIs should stay scoped inside the `if (import.meta.vitest)` block.
- Consumer-facing API inputs should prefer identifiers and let Core infer authoritative fields instead of accepting duplicated inferable values.
- Runtime/port calls that perform external actions should receive resolved values needed to perform the action so adapters do not infer authoritative context themselves.

## Work Guidance

- Keep `model.ts` focused on data shapes and domain records.
- Keep `api.ts` focused on public API, ports, validation, and runtime boundary behavior.
- Prefer `Result` returns for Core boundary failures over thrown expected errors.
- Preserve typed linting and type-only imports.
- Do not move tests to a root Vitest config; package tests belong to this package.

## Verification

- From repo root, run `pnpm --filter @gorchestra/core test` for Core package tests.
- From repo root, run `pnpm typecheck` for project-reference typechecking.
- From repo root, run `pnpm lint` for typed ESLint.
- From repo root, run `pnpm format` after source or package config changes.

## Child DOX Index

No child AGENTS.md files currently required.
