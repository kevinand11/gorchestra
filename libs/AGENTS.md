# Libraries DOX

## Purpose

The `libs/` tree contains workspace packages that implement Gorchestra source surfaces.

## Ownership

- `libs/AGENTS.md` owns package-workspace contracts and the package Child DOX Index.
- Each package owns its local source, package manifest, tests, and package-local tool config.
- Root tooling owns repo-wide lint, typecheck, formatting, package manager, and project-reference orchestration.

## Local Contracts

- Packages live under `libs/*` and are included by `pnpm-workspace.yaml`.
- Package tests should be configured in the package, not in root Vitest config.
- Package source changes that alter durable domain language or decisions must be synchronized with relevant docs.

## Work Guidance

- Prefer package-local configs for package behavior and root configs for repo-wide orchestration.
- Keep package boundaries explicit through package manifests and TypeScript project references.
- Do not add new packages without adding or updating the relevant child AGENTS.md entry.

## Verification

- From repo root, run `pnpm lint`, `pnpm typecheck`, and `pnpm test` after package source changes.
- Use package-specific verification from the nearest child AGENTS.md when available.

## Child DOX Index

- `libs/core/AGENTS.md` — Core package source and test contracts.
