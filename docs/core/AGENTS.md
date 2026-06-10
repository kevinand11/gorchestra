# Core Documentation DOX

## Purpose

The `docs/core/` tree documents Core domain language, durable Core decisions, and Core-specific context for reusable Portfolio-level orchestration.

## Ownership

- `CONTEXT.md` owns current Core domain language and the map of Core ADRs.
- `adr/` owns durable Core decisions.
- Core package source under `../../libs/core/` owns the current Core package type/runtime contract.

## Local Contracts

- Read `CONTEXT.md` before changing Core documentation.
- Read relevant ADRs in `adr/` before changing, superseding, or adding Core decisions.
- Keep Core documentation aligned with `../../libs/core/src/domain/` and `../../libs/core/src/api.ts` when changes affect both domain language and package source.
- Do not encode Server Consumer tenancy or authorization policy as Core-owned behavior; Consumers own application-layer auth, tenancy, and deployment concerns.

## Work Guidance

- Use Core terminology from `CONTEXT.md` consistently.
- Add an ADR only for durable decisions with meaningful trade-offs; do not create ADRs for routine edits.
- Prefer discriminated unions and atomic embedded records when documenting lifecycle shapes.
- Keep portable Core concepts separate from Server Consumer deployment details.

## Verification

- From repo root, run `pnpm format` after Core documentation changes.
- If Core package source also changes, run `pnpm lint`, `pnpm typecheck`, and `pnpm --filter @gorchestra/core test`.

## Child DOX Index

- `adr/` — Core ADRs. No child AGENTS.md currently required.
