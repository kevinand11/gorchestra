# Server Consumer Package DOX

## Purpose

The `consumers/server/` package implements the v1 deployed Server Consumer: Nuxt browser app, internal Equipped API, authentication, Sessions, Workspace and Portfolio selection, Workspace Provisioning, and Server-to-Core runtime assembly.

## Ownership

- `package.json`, `nuxt.config.ts`, and package-local TypeScript/Vitest config own Server Consumer package tooling.
- `src/` owns internal API runtime, Server-owned domain/storage, auth/session/selection, Workspace Provisioning, and Core service assembly.
- `src/storage/` owns Server-owned JSON ORM schemas, migrations, and repo assembly; it must not contain Core Portfolio facts.
- `src/modules/` owns application use-case functions; API route handlers should stay thin adapters over these functions.
- `pages/`, `middleware/`, and `composables/` own Nuxt UI and client-side app concerns.

## Local Contracts

- Read `../../docs/consumers/CONTEXT.md`, `../../docs/consumers/server/CONTEXT.md`, and relevant Server Consumer ADRs before changing source behavior.
- Server-owned storage must not store Core Portfolio facts except Portfolio registry metadata and Core storage locations.
- Portfolio-scoped API routes must validate the signed-in User, Selection Cookie, Active Workspace membership, and Portfolio registry ownership before opening Core.
- Initial slice exposes no Project/Plan/Delivery Core UI/API routes; add explicit Core queries before adding standalone Core read routes.
- Do not require `GORCHESTRA_SECRET_ENCRYPTION_KEY` until Secret management routes and encrypted Secret vault support are implemented.
- `GET` routes must be read-only; do not refresh Sessions, set cookies, or mutate cache/storage from `GET` handlers.
- Server storage code must depend on the generic `ServerStorageAdapter` contract; adapter-specific imports belong only in adapter factory files.
- Server storage is opened once during application startup; module functions must not open, migrate, or close Server storage per operation.
- Test module functions directly with plain inputs and real storage/cache/Core wiring; do not test API endpoints or mock Equipped request/response values for this slice.

## Work Guidance

- Keep files focused and test service logic independently from route wiring.
- Use cache-backed OTP and Session state; use Equipped JSON ORM for durable Server-owned state.
- Keep Nuxt public runtime and internal Equipped API process boundaries explicit.

## Verification

- From repo root, run `pnpm --filter @gorchestra/server test`.
- From repo root, run `pnpm --filter @gorchestra/server typecheck` if package script exists.
- From repo root, run `pnpm typecheck`, `pnpm lint`, and `pnpm format` before claiming completion.

## Child DOX Index

No child AGENTS.md files currently required.
