# Form Draft Package DOX

## Purpose

The `libs/form-draft/` package owns reusable Vue-backed form draft primitives: reactive fields, Valleyed validation, dirty tracking, nested drafts, draft arrays, entity loading, reset, and submit-model conversion.

## Ownership

- `src/index.ts` owns the public package API and source tests.
- `package.json`, `tsconfig.json`, and `vitest.config.ts` own package-local tooling.

## Local Contracts

- `vue` and `valleyed` are peer dependencies so the package can be published independently later.
- Keep the core class named `FormDraft`; application-specific subclasses should use names like `MemoryFormDraft`.
- Expose field-level dirty checks through `isDirty(...)`; aggregate `dirty` should derive from field-level checks.
- Support nested `FormDraft` values and `FormDraftArray` collections without consumers hand-wiring listeners.

## Verification

- From repo root, run `pnpm --filter @gorchestra/form-draft test` after package changes.
- From repo root, run `pnpm typecheck`, `pnpm lint`, and `pnpm format` before claiming completion.

## Child DOX Index

No child AGENTS.md files currently required.
