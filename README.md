# Gorchestra

Gorchestra is a goal-oriented delivery orchestration project. This repository contains the reusable Core orchestration package and the v1 Server Consumer app layer.

## Workspace layout

This repo is a private pnpm workspace. The root `package.json` owns product process scripts, shared TypeScript, lint, formatting, and test tooling. `pnpm-workspace.yaml` includes packages under `libs/*` and `consumers/*`.

Current workspace packages:

- `libs/core` (`@gorchestra/core`) — a private internal package exported directly from source (`./src/index.ts`) for workspace packages to consume.
- `libs/form-draft` (`@gorchestra/form-draft`) — private form draft primitives used by consumer UI forms.
- `consumers/server` (`@gorchestra/consumer-server`) — the private v1 Server Consumer package, started by the root application entrypoint.

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
