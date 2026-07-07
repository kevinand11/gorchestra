# Server-owned ids and Server-owned list pagination

The Server Consumer uses lowercase 26-character monotonic Equipped ids for Server-owned durable record primary keys and server-managed browser Session ids. These are **Server Ids**, not Core Ids, even though v1 intentionally uses the same concrete sortable format as Core. Server-owned storage namespaces, including `coreStorageNamespace`, remain storage-location strings rather than Server Ids.

Server-owned list endpoints generally return Equipped-style paginated query envelopes: `{ items, pages, docs }`. Public paginated list inputs accept optional `limit`, `page`, and `beforeId`, where `beforeId` is an exclusive Server Id upper bound. Stored-record-backed Server-owned lists use id-desc ordering by their primary Server-owned record id unless an endpoint explicitly documents another primary Server-owned record.

`GET /api/workspaces` is an intentionally unpaginated Server-owned aggregate selector list over the signed-in User's Active Member Workspaces, because Workspaces and nested Portfolio Registry Entries are expected to remain small and the selector needs the complete hierarchy. It returns the full array ordered by Workspace id descending, with each Workspace record as the root item and nested `member`, active `ownerRole`, and `portfolios` array of full Portfolio Registry Entries ordered by Portfolio Registry Entry id descending. Active Member Workspaces are included even when they have no registered Portfolios, in which case `portfolios` is empty.

This is a pre-v1 direct replacement. There is no compatibility migration for existing local Server storage with UUID record ids; local development storage may need to be reset or rewritten manually.
