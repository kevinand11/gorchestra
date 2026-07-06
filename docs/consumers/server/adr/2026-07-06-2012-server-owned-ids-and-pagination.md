# Server-owned ids and Server-owned list pagination

The Server Consumer uses lowercase 26-character monotonic Equipped ids for Server-owned durable record primary keys and server-managed browser Session ids. These are **Server Ids**, not Core Ids, even though v1 intentionally uses the same concrete sortable format as Core. Server-owned storage namespaces, including `coreStorageNamespace`, remain storage-location strings rather than Server Ids.

Server-owned list endpoints return Equipped-style paginated query envelopes: `{ items, pages, docs }`. Public list inputs accept optional `limit`, `page`, and `beforeId`, where `beforeId` is an exclusive Server Id upper bound. Stored-record-backed Server-owned lists use id-desc ordering by their primary Server-owned record id unless an endpoint explicitly documents another primary Server-owned record.

`GET /api/workspaces` is a Server-owned aggregate list over the signed-in User's Active Member Workspaces. It orders items by Workspace id descending, uses Workspace id as the `beforeId` boundary, and exposes each Workspace record as the root item with nested `member`, active `ownerRole`, and a `portfolios` array of full Portfolio Registry Entries ordered by Portfolio Registry Entry id descending. Active Member Workspaces are included even when they have no registered Portfolios, in which case `portfolios` is empty.

This is a pre-v1 direct replacement. There is no compatibility migration for existing local Server storage with UUID record ids; local development storage may need to be reset or rewritten manually.
