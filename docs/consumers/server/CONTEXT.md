# Gorchestra Server Consumer

The Server Consumer is the v1 Gorchestra app layer. It uses the Portfolio-level core while adding deployed multi-user tenancy, authentication, Workspace membership, Workspace ownership, and a global registry of Portfolios.

## Language

**Server Consumer**:
The v1 Gorchestra consumer: a deployed server app that registers Portfolios inside Workspaces and supports multi-user tenancy.
_Avoid_: Core

**Agent Run Dispatcher**:
The Server Consumer capability that receives Core Agent Run Dispatch Requests and arranges Agent Run runtime execution for the selected Portfolio. The dispatcher is responsible for execution arrangement, not for deciding Core Agent Run behavior.
_Avoid_: Scheduler, worker agent, Core runtime

**User**:
A global app identity in the Server Consumer. A User may have separate Workspace Member identities in different Workspaces.
_Avoid_: Workspace Member, account

**Authentication Method**:
A Server Consumer mechanism that verifies control of an external identity before the app treats an actor as a User.
_Avoid_: Authorization method, permission check

**Authentication Identity**:
A durable external identity verified by an Authentication Method and associated with one User. A User may have multiple Authentication Identities over time.
_Avoid_: User, account, login

**Email Authentication Identity**:
An Authentication Identity for one normalized email address. The normalized email is trimmed and lowercased in full, and each normalized email address belongs to at most one Email Authentication Identity.
_Avoid_: User email, account email

**Verified Email Address**:
An email address whose control has been verified by an Authentication Method or asserted as verified by an external authentication provider.
_Avoid_: Claimed email, contact email

**Email OTP Sign-in**:
An Authentication Method where control of an email address is proven by submitting a one-time passcode sent to that address.
_Avoid_: Email authorization, magic link

**Email OTP Challenge**:
A short-lived Email OTP Sign-in attempt for one normalized email address. An Email OTP Challenge does not create a User or Authentication Identity until the passcode is verified, and only the latest unverified challenge for an email remains valid.
_Avoid_: Pending User, pending account

**Self-sign-up**:
A first-party onboarding path where a verified Authentication Identity creates a new User and Session without requiring an invitation. Self-sign-up does not create a Workspace or Portfolio.
_Avoid_: Workspace provisioning, invited-user creation

**Workspace Provisioning**:
A user-initiated workflow that creates a Workspace, creates the initiating User's Workspace Member identity and Workspace Owner role, registers the Workspace's Default Portfolio, and selects that new Workspace and Portfolio. In v1, Workspace Provisioning is exposed only when the signed-in User has no accessible Workspace and Portfolio to select.
_Avoid_: Self-sign-up, Portfolio-only creation

**Session**:
A server-managed browser sign-in state for one User. A Session does not store Workspace or Portfolio selection and does not itself grant Workspace access or Workspace Owner authority.
_Avoid_: Authorization token, durable login record, Workspace selection

**Selection Cookie**:
A server-signed browser-readable cookie that carries the selected Workspace and selected Portfolio for requests. A missing or invalid Selection Cookie means no Workspace or Portfolio is selected, and a Selection Cookie does not grant access; the server validates current Workspace membership and Portfolio registry ownership before using it.
_Avoid_: Authorization token, Session

**Selection Required**:
A Server Consumer request state where the signed-in User has no valid Selected Workspace and Selected Portfolio for a Portfolio-scoped request. Page requests redirect to selection, while Portfolio-scoped API requests fail with HTTP 428 Precondition Required so browser clients can redirect to selection. The Selection introspection API still returns structured selection state.
_Avoid_: Unauthorized, unauthenticated

**Workspace**:
The top-level tenancy boundary in the Server Consumer. A Workspace has a non-unique user-facing display name, groups members, and registers Portfolios.
_Avoid_: Organization, account, team

**Selected Workspace**:
The Workspace carried by the Selection Cookie for navigation and workspace-scoped requests. A Selected Workspace does not grant access; access still comes from current Workspace membership and roles.
_Avoid_: Current account, tenant claim

**Selected Portfolio**:
The Portfolio carried by the Selection Cookie inside the Selected Workspace. A Selected Portfolio does not grant access; v1 Portfolio access still comes from current Workspace membership.
_Avoid_: Current project space, portfolio claim

**Portfolio Registry Entry**:
A Server Consumer registration of a Core Portfolio inside a Workspace. The Portfolio Registry Entry owns the Portfolio's non-unique user-facing display name and storage location.
_Avoid_: Core Portfolio record, Portfolio metadata in Core

**Default Portfolio**:
The oldest Portfolio registered for a Workspace. The Default Portfolio is administered by the Workspace's Active Workspace Owners.
_Avoid_: Personal Portfolio, Workspace data

**Brain**:
The selected-Portfolio Server Consumer surface for exploring Portfolio context, including the Portfolio Graph and curated Portfolio Memory. Brain is UI/product language; Core domain language remains Portfolio Graph, Portfolio Memory, Memory, and Link.
_Avoid_: Project Brain, Workspace Brain, knowledge base

**Brain Graph**:
The Brain view that presents the selected Portfolio's Portfolio Graph. Brain Graph includes isolated graph nodes, Core Links, and non-fact visual Structure Edges for containment context.
_Avoid_: Memory graph, Project graph, relationship map

**Structure Edge**:
A Brain Graph visual connector that shows containment or navigation context between graph nodes without representing a Core Link or stored Portfolio fact.
_Avoid_: Link, relationship, dependency

**Memories**:
The Brain hierarchy view that lists root Memories and lets users navigate parent-child Memory structure. It presents Portfolio Memory like a database-backed Obsidian vault tree rather than a flat Memory database.
_Avoid_: Memory Ledger, Memory database, Project memory list, flat note list

**Memory Detail**:
The Brain view for one Memory. Memory Detail presents the Memory's current revision content, supports Memory Editing for current content, and, when present, shows child Memories in the same hierarchy model as the Memories root.
_Avoid_: selected Memory panel, Memory record page

**Memory Editing**:
The Brain interaction that saves a new Memory Revision for an existing Memory's title or body. Memory Editing changes current revision content without changing the Memory's parent relationship.
_Avoid_: Memory editor, reparenting, Memory Inline Link Editing

**Memory Inline Link Editing**:
The Brain interaction that creates, removes, or changes authored Memory-to-Memory links inside a Memory Revision body. Memory Inline Link Editing is note editing, not standalone Core Link creation.
_Avoid_: Core Link creation, relationship editor, bidirectional Link creation

**New Memory**:
The Brain interaction for manually creating one root or child Memory in Portfolio Memory. New Memory chooses the parent relationship at creation time and then makes the created Memory the active Memory Detail.
_Avoid_: Memory editor, Memory draft, Create Memory page

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
