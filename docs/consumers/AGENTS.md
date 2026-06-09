# Consumers Documentation DOX

## Purpose

The `docs/consumers/` tree documents application-layer contexts that consume Core, including consumer-wide boundaries and consumer-specific ADRs.

## Ownership

- `CONTEXT.md` owns consumer-wide domain language and the map of Consumer ADRs.
- `adr/` owns durable consumer-wide decisions.
- Child consumer docs own local consumer-specific language and decisions.

## Local Contracts

- Read `CONTEXT.md` before changing Consumer documentation.
- Read relevant ADRs in `adr/` before changing, superseding, or adding consumer-wide decisions.
- Keep Consumer authority, authentication, authorization, tenancy, and runtime responsibilities distinct from Core-owned Portfolio data and orchestration behavior.
- Keep consumer docs aligned with Core docs when describing Consumer → Core and Core → Consumer boundaries.

## Work Guidance

- Use Consumer terminology from `CONTEXT.md` consistently.
- Document application-layer responsibilities here; do not move reusable Portfolio-level orchestration behavior out of Core docs.
- Add an ADR only for durable decisions with meaningful trade-offs.

## Verification

- From repo root, run `pnpm format` after Consumer documentation changes.
- If documentation changes accompany source changes, also run the relevant source verification from that subtree.

## Child DOX Index

- `docs/consumers/server/AGENTS.md` — Server Consumer documentation contracts.
- `adr/` — Consumer-wide ADRs. No child AGENTS.md currently required.
