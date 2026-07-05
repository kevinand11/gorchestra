# Form Draft Package DOX

## Purpose

The `libs/form-draft/` package owns reusable Vue-backed form draft primitives: reactive fields, Valleyed validation, dirty tracking, nested drafts, draft arrays, entity loading, reset, and submit-model conversion.

## Ownership

- `src/index.ts` owns the public package barrel exports; focused source modules under `src/` own implementations, and `src/*.test.ts` owns package source tests.
- `package.json`, `tsconfig.json`, and `vitest.config.ts` own package-local tooling.

## Local Contracts

- `vue` and `valleyed` are peer dependencies so the package can be published independently later.
- Keep the core class named `FormDraft`; application-specific subclasses should use names like `MemoryFormDraft`.
- Expose field-level dirty checks through `isDirty(...)`; aggregate `dirty` should derive from field-level checks.
- Support nested `FormDraft` values and `FormDraftArray` collections without consumers hand-wiring listeners; nested validation must flow through `nestedFormDraftPipe()` so Valleyed wrappers can control it.
- Keep `README.md` current as the package usage guide for field pipes, nested drafts, draft arrays, atomic object/array exceptions, submit-model conversion, select modeling, and option membership semantics.
- Model object and array fields as nested drafts by default: use a plain object or array field only when the user interaction replaces the whole value atomically. If the UI edits fields inside an object, use a nested `FormDraft`; if the UI edits items inside an array, use `FormDraftArray` via `FormDraft.array()` with item drafts.
- Field rules validate the visible field value and must not live-transform it with pipes such as `v.asTrimmed()` or trim-based custom validators; canonical cleanup belongs at the server/API/Core boundary unless `toModel()` is intentionally converting the draft shape to the submit model.

## Verification

- From repo root, run `pnpm --filter @gorchestra/form-draft test` after package changes.
- From repo root, run `pnpm typecheck`, `pnpm lint`, and `pnpm format` before claiming completion.

## Child DOX Index

No child AGENTS.md files currently required.
