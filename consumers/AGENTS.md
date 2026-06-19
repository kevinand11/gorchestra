# Consumers Package DOX

## Purpose

The `consumers/` tree contains application packages that consume Gorchestra Core and provide user experience, authentication, authorization, and deployment-specific runtime concerns.

## Ownership

- `consumers/AGENTS.md` owns consumer package workspace contracts and the consumer package Child DOX Index.
- Each consumer package owns its source, package manifest, tests, and package-local tool config.
- Consumer packages must keep app-layer concerns separate from reusable Core orchestration behavior.

## Local Contracts

- Packages live under `consumers/*` and are included by `pnpm-workspace.yaml`.
- Before changing Server Consumer source, read `../docs/consumers/CONTEXT.md`, `../docs/consumers/server/CONTEXT.md`, and relevant ADRs.
- Package source changes that alter durable domain language or decisions must be synchronized with docs.

## Work Guidance

- Keep consumer-owned authentication, authorization, tenancy, sessions, routing, and deployment mechanics out of Core.
- Use Core commands for Core-owned mutations and Core queries for standalone reads of Core-owned Portfolio state.
- Keep package boundaries explicit through package manifests and TypeScript project references.

## Verification

- From repo root, run `pnpm --filter @gorchestra/server test` for Server Consumer package tests.
- From repo root, run `pnpm typecheck`, `pnpm lint`, and `pnpm format` after consumer package changes.

## Child DOX Index

- `consumers/server/AGENTS.md` — Server Consumer Nuxt and Equipped API source contracts.
