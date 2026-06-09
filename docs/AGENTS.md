# Documentation DOX

## Purpose

The `docs/` tree contains canonical domain context, ADRs, coverage notes, and durable documentation for Gorchestra.

## Ownership

- `docs/AGENTS.md` owns documentation-wide contracts and the documentation Child DOX Index.
- Child docs own local domain documentation contracts.
- Documentation should explain durable language and decisions, not duplicate package implementation details.

## Local Contracts

- Context files define current domain language for their scope.
- ADRs record durable, surprising, or trade-off-heavy decisions.
- ADR filenames use sortable date+time prefixes: `YYYY-MM-DD-HHMM-slug.md`.
- Update relevant context docs or ADRs when a change alters durable domain language, decisions, responsibilities, or relationships.
- Prefer linking to canonical source or context over duplicating detailed rules in multiple docs.

## Work Guidance

- Read the nearest context file before changing domain documentation.
- Read relevant ADRs before changing or superseding a documented decision.
- If source changes and docs changes are part of the same semantic change, keep them synchronized in the same branch.
- Keep documentation concise, operational, and current; delete stale notes rather than explaining obsolete history.

## Verification

- From repo root, run `pnpm format` after Markdown/documentation changes.
- If documentation changes accompany source changes, also run the relevant source verification from that subtree.

## Child DOX Index

- `docs/core/AGENTS.md` — Core domain context and ADR documentation contracts.
- `docs/consumers/AGENTS.md` — Consumer context and ADR documentation contracts.
