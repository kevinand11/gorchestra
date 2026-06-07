# Gorchestra Server Consumer

The Server Consumer is the v1 Gorchestra app layer. It uses the Portfolio-level core while adding deployed multi-user tenancy, authentication, Workspace membership, Workspace ownership, and a global registry of Portfolios.

## Language

**Server Consumer**:
The v1 Gorchestra consumer: a deployed server app that registers Portfolios inside Workspaces and supports multi-user tenancy.
_Avoid_: Core

**User**:
A global app identity in the Server Consumer. A User may have separate Workspace Member identities in different Workspaces.
_Avoid_: Workspace Member, account

**Workspace**:
The top-level tenancy boundary in the Server Consumer. A Workspace groups members and registers Portfolios.
_Avoid_: Organization, account, team

**Workspace Member**:
A User's durable identity inside a Workspace. Workspace Members are preserved for attribution even when their active membership changes over time.
_Avoid_: WorkspaceUser, participant

**Active Member**:
A Workspace Member whose latest membership period has not ended.
_Avoid_: Member status

**Inactive Member**:
A Workspace Member whose latest membership period has ended or who has no active membership period.
_Avoid_: Former user, deleted user

**Workspace Owner**:
A Workspace role that grants ownership authority. Workspace ownership is assigned to Workspace Members through roles rather than stored as a Workspace property.
_Avoid_: owner field

**Active Workspace Owner**:
An Active Member with an active Workspace Owner role. Every Workspace must have at least one Active Workspace Owner.
_Avoid_: Primary owner, account owner
