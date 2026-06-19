# Gorchestra Consumers

Gorchestra consumers are application layers that use the reusable Portfolio-level core. The v1 consumer is the Server Consumer; future consumers may provide other workflows without server-app tenancy.

## Contexts

- [Server Consumer](./server/CONTEXT.md) — deployed multi-user app with Workspaces, Workspace Members, Workspace Owners, and a registry of Portfolios.

## Language

**Consumer**:
An application layer that uses the Gorchestra core. Consumers provide user experience, authorization, Secret protection mechanics, and runtime integration around Portfolio orchestration. Consumers authorize operations before calling core.
_Avoid_: Core

**Portfolio Owner**:
The actor a Consumer treats as authorized to administer a Portfolio. Each Consumer defines how Portfolio Owner authority is granted or inferred.
_Avoid_: portfolio createdBy

## Relationships

- **Consumers → Core**: Consumers create, open, authorize, protect, operate, and read Portfolios through the core orchestration model.
- **Server Consumer → Core**: The Server Consumer registers Portfolios inside Workspaces, maps Workspace Owner authority to Portfolio Owner authority for the default Portfolio in v1, and handles server-specific Secret-at-rest protection.
- **Core → Consumers**: Core owns Portfolio data and portable Portfolio Snapshots; consumers provide user experience, authentication, authorization, and deployment-specific runtime concerns.
