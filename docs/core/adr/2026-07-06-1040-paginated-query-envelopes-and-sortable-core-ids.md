# Paginated query envelopes and sortable Core ids

Core list queries return Equipped ORM-style Paginated Query Envelopes and use Core ids as their canonical ordering and pagination boundary. Core-generated ids are lowercase 26-character ULIDs produced by the runtime boundary, lexicographically sortable by creation order, and validated strictly as lowercase Core ids at Core API and storage boundaries. Consumers and external actor references remain opaque strings; this decision applies only to Core-owned record ids.

Core public list queries return `{ items, pages, docs }` for both bounded and unbounded reads rather than bare arrays. The envelope vocabulary matches Equipped ORM exactly: `items` contains the ordered records, `pages` contains page navigation metadata, and `docs` contains limit/count/total metadata. Omitted `limit` means all matching records in one ordered envelope; `limit` without `page` means the first bounded batch; `page` requires `limit`; `beforeId` is an optional exclusive Core-id upper bound and is omitted rather than sent as `null`. Public list inputs do not expose generic Equipped/legacy DB query parameters such as `where`, `sort`, `select`, `search`, or `all`.

Core public stored-record and read-model list outputs use id-desc order, including public nested arrays loaded for page items. Internal runtime reads and derivations may still choose semantic order when the algorithm requires it, such as Delivery work dependency evaluation or model context projection. Query implementations paginate primary records first, then load related records only for the returned page item ids, skipping related reads for empty pages. Storage-backed related reads pass their required order to Equipped ORM instead of sorting in memory.

Agent Run Event cursors are removed. `AgentRunEvent.id` is the transcript ordering, reference, compaction boundary, and list-window handle. Event body fields that previously referenced cursors are direct event-id fields such as `contextThroughEventId`, `turnStartedEventId`, `inputEventIds`, `assistantMessageEventId`, `respondsToAssistantMessageEventId`, `proposalEventId`, and `compactedThroughEventId`. `CoreRuntimeValues` keeps `nextId(): string` and `now(): Date`; it no longer exposes `nextCursor()` or id-scope parameters.

This is a pre-v1 direct schema replacement with no compatibility layer for old event cursor records or old list response shapes. Local development storage may be rewritten in place after taking a timestamped backup.

## Consequences

- Core depends on Equipped's no-argument monotonic lowercase `Instance.createId()` for production id generation and does not depend directly on `ulid`.
- Server Consumer API routes forward parsed Core pagination inputs and return Core envelopes directly for Core-owned list endpoints.
- Server client list composables can accumulate id-desc pages with `beforeId` while hiding envelope metadata from page components when the UI only needs items and `hasNext`.
- Server Consumer-owned ids and Server Consumer-owned list pagination remain a separate follow-up decision.
- The earlier Consumers ADR statement that `listProjects` returned Projects without filters or pagination is superseded by this ADR for Core list query shape and ordering.
