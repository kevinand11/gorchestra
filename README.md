# Gorchestra

Gorchestra is a goal-oriented delivery orchestration project. This repository currently contains the early monorepo scaffold and Core domain/API sketches; it does **not** yet implement real Core orchestration behavior.

## Workspace layout

This repo is a private pnpm workspace. The root `package.json` owns shared TypeScript, lint, formatting, and test tooling, and `pnpm-workspace.yaml` includes packages under `libs/*`.

Current workspace package:

- `libs/core` (`@gorchestra/core`) — a **private internal** package exported directly from source (`./src/index.ts`) for other workspace packages to consume while the Core design is being built.

## Common commands

Install dependencies from the repository root:

```bash
pnpm install
```

Run the common quality gates from the repository root:

```bash
pnpm lint
pnpm format
pnpm typecheck
pnpm test
```

Useful fix commands:

```bash
pnpm lint:fix
pnpm format:fix
```

## Current implementation status

The Core package is intentionally minimal right now. Its TypeScript files document domain shapes, API boundaries, input validation, and stubbed runtime entry points. Treat those files as source-level design scaffolding for contributors and agents, not as working orchestration behavior.
