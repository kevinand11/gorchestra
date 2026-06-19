# Gorchestra

## Purpose

Gorchestra is a goal-oriented delivery orchestration platform for coordinating planning, execution, review, and shipping work.

This root AGENTS.md is the project-wide DOX rail: it gives repo-wide instructions, global domain orientation, durable modeling preferences, and the top-level child index.

## Ownership

- Root owns project-wide agent process, global domain relationships, and the Child DOX Index.
- Child AGENTS.md files own local contracts for their subtrees.
- The closer AGENTS.md controls local work details, but child docs must not weaken root-level contracts.
- Do not scan or treat `.trowel/` as project source.
- Never add `fallow-ignore` suppressions; resolve Fallow findings by improving code or adjusting the underlying design instead of hiding them.

## Local Contracts

- AGENTS.md files are binding work contracts for their subtrees.
- Before editing, read this file and every AGENTS.md on the path to each target file.
- Do not rely on memory. Re-read the applicable AGENTS chain in the current session before editing.
- After meaningful changes, update the closest owning AGENTS.md and any affected parent or child indexes.
- Keep AGENTS.md files concise, current, operational, and focused on stable contracts rather than diary entries.

## Work Guidance

### Domain map

- **Core** is reusable Portfolio-level orchestration. Core owns Portfolio data and portable Portfolio Snapshots.
- **Consumers** are application layers that consume Core and provide user experience, authentication, authorization, and deployment-specific runtime concerns.
- **Server Consumer** is the v1 deployed multi-user app with Workspaces, Workspace Members, Workspace Owners, and a registry of Portfolios.
- **CLI Consumer** is a future local app layer that may infer a local user and Portfolio Owner without exposing Workspace concepts.

### Context relationships

- **Consumers → Core**: Consumers create, open, authorize, protect, and operate Portfolios through the Core orchestration model.
- **Server Consumer → Core**: The Server Consumer registers Portfolios inside Workspaces, maps Workspace Owner authority to Portfolio Owner authority for the default Portfolio in v1, and handles server-specific Secret-at-rest protection.
- **CLI Consumer → Core**: A future CLI Consumer can infer one local user and Portfolio Owner without exposing Workspace concepts.
- **Core → Consumers**: Core owns Portfolio data and portable Portfolio Snapshots; consumers provide user experience, authentication, authorization, and deployment-specific runtime concerns.

### Global modeling preferences

- Do not export a variable, function, type, or class from a file until another module or public package surface needs it; keep declarations file-local by default.
- Core lifecycle data shapes use `field: RuntimeRecord` for runtime lifecycle timestamps, direct domain-named `AuditStamp` fields for consumer-authorized operations, and domain-specific embedded records when a lifecycle moment has additional fields.
- Authoritative Delivery lifecycle gates such as queueing and closure live on direct Delivery lifecycle fields with domain-named `AuditStamp` records; non-lifecycle execution facts remain Actions.
- Embedded records must contain all fields that change atomically with that lifecycle moment, so the model cannot represent half-updated states.
- Prefer discriminated unions over nullable peer fields when exactly one variant applies.
- Prefer passing identifiers and inferring authoritative fields inside Core over duplicating inferable values in consumer-facing API inputs, so callers cannot provide contradictory values.
- For Core-owned provider/runtime behavior and Core Service calls that perform external actions, resolved values should be available at the boundary so service/provider code does not infer, load, or calculate authoritative context itself.

## Verification

- Use the closest child AGENTS.md for subtree-specific checks.
- For repo-wide source/config changes, run from repo root: `pnpm lint`, `pnpm typecheck`, `pnpm test`, `pnpm format`, and `pnpm fallow:audit`.

## Child DOX Index

- `consumers/AGENTS.md` — consumer application package contracts and package child index.
- `docs/AGENTS.md` — documentation contracts, context docs, ADR rules, and documentation child index.
- `libs/AGENTS.md` — workspace package contracts and package child index.
