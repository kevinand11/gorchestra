# Server Consumer Documentation DOX

## Purpose

The `docs/consumers/server/` tree documents the v1 deployed multi-user Server Consumer: Workspaces, Workspace Members, Workspace Owners, Portfolio registry behavior, and server-specific protection concerns.

## Ownership

- `CONTEXT.md` owns Server Consumer domain language and the map of Server Consumer ADRs.
- `adr/` owns durable Server Consumer decisions.
- Parent Consumer docs own consumer-wide boundaries that Server Consumer docs must respect.

## Local Contracts

- Read `CONTEXT.md` before changing Server Consumer documentation.
- Read relevant ADRs in `adr/` before changing, superseding, or adding Server Consumer decisions.
- Keep Workspace Owner authority and Portfolio Owner authority language aligned with parent Consumer docs and Core authority boundaries.
- Keep server-specific Secret-at-rest protection documented as a consumer concern, not a Core concern.

## Work Guidance

- Use Server Consumer terminology from `CONTEXT.md` consistently.
- Keep v1 Workspace role language explicit; do not imply broader role models unless docs/ADRs define them.
- Add an ADR only for durable decisions with meaningful trade-offs.

## Verification

- From repo root, run `pnpm format` after Server Consumer documentation changes.
- If documentation changes accompany source changes, also run the relevant source verification from that subtree.

## Child DOX Index

- `adr/` — Server Consumer ADRs. No child AGENTS.md currently required.
