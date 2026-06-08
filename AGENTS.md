# Gorchestra

## Agent skills

### Domain docs

Gorchestra has multiple domain contexts:

- Core context: `docs/core/CONTEXT.md`
  - Core ADRs: `docs/core/adr/`
- Consumers context map: `docs/consumers/CONTEXT.md`
  - Consumer-wide ADRs: `docs/consumers/adr/`
- Server Consumer context: `docs/consumers/server/CONTEXT.md`
  - Server Consumer ADRs: `docs/consumers/server/adr/`

ADR filenames use sortable date+time prefixes: `YYYY-MM-DD-HHMM-slug.md`.

Core lifecycle data shapes use embedded records for extensibility: use `field: RuntimeRecord` for runtime lifecycle timestamps and `field: AuditedRecord` for consumer-authorized operations. The embedded record must contain all fields that change atomically with that lifecycle moment, so the model cannot represent half-updated states.

## Context relationships

Gorchestra is a goal-oriented delivery orchestration platform for coordinating planning, execution, review, and shipping work.

- **Core** is reusable Portfolio-level orchestration: Portfolio graph, Projects, Goals, Plans, Deliveries, Slices, Executions, Missions, Memories, Secrets, and Portfolio Snapshots.
- **Consumers** are application layers that consume Core.
- **Server Consumer** is the v1 deployed multi-user app with Workspaces, Workspace Members, Workspace Owners, and a registry of Portfolios.
- **CLI Consumer** is a future local app layer that may infer a local user and Portfolio Owner without exposing Workspace concepts.
- **Consumers → Core**: Consumers create, open, authorize, protect, and operate Portfolios through the Core orchestration model.
- **Server Consumer → Core**: The Server Consumer registers Portfolios inside Workspaces, maps Workspace Owner authority to Portfolio Owner authority for the default Portfolio in v1, and handles server-specific Secret-at-rest protection.
- **CLI Consumer → Core**: A future CLI Consumer can infer one local user and Portfolio Owner without exposing Workspace concepts.
- **Core → Consumers**: Core owns Portfolio data and portable Portfolio Snapshots; consumers provide user experience, authentication, authorization, and deployment-specific runtime concerns.
