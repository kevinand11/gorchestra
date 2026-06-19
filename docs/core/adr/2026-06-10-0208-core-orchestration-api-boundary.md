# Core Orchestration API boundary

Superseded by [Core queries for Portfolio reads](../../consumers/adr/2026-06-18-1515-core-query-read-boundary.md).

Core public commands, queries, and Snapshot operations remain the Core Orchestration API, but Consumers now read Core-owned Portfolio state through Core queries rather than consumer-owned storage access or projections. Mutations that affect Core invariants, lifecycle facts, or whole-Portfolio contents still go through Core commands or Snapshot restore, and Snapshot export/restore still live under their own Core API namespace because they operate on the whole currently-open Portfolio rather than one orchestration command target.
