# Server Consumer Documentation DOX

## Purpose

The `docs/consumers/server/` tree documents the v1 deployed multi-user Server Consumer: Workspaces, Workspace Members, Workspace Owners, Portfolio registry behavior, and server-specific protection concerns.

## Ownership

- `CONTEXT.md` owns Server Consumer domain language and the map of Server Consumer ADRs.
- `DESIGN_SYSTEM.md` owns Server Consumer visual/product UI design guidance.
- `adr/` owns durable Server Consumer decisions.
- Parent Consumer docs own consumer-wide boundaries that Server Consumer docs must respect.

## Local Contracts

- Read `CONTEXT.md` before changing Server Consumer documentation.
- Read `DESIGN_SYSTEM.md` before changing Server Consumer UI design guidance or source UI layouts.
- Read relevant ADRs in `adr/` before changing, superseding, or adding Server Consumer decisions.
- Keep Workspace Owner authority and Portfolio Owner authority language aligned with parent Consumer docs and Core authority boundaries.
- Keep server-specific Secret-at-rest protection documented as a consumer concern, not a Core concern.

## Work Guidance

- Use Server Consumer terminology from `CONTEXT.md` consistently.
- Use `DESIGN_SYSTEM.md` for Server Consumer UI layout, density, separator, list, form, and shared control decisions.
- Keep v1 Workspace role language explicit; do not imply broader role models unless docs/ADRs define them.
- Add an ADR only for durable decisions with meaningful trade-offs.

## Verification

- From repo root, run `pnpm format` after Server Consumer documentation changes.
- If documentation changes accompany source changes, also run the relevant source verification from that subtree.

## Child DOX Index

- `DESIGN_SYSTEM.md` — Server Consumer UI design-system guidance.
- `TODO.md` — intentionally deferred Server Consumer follow-up items.
- `adr/` — Server Consumer ADRs. No child AGENTS.md currently required.
