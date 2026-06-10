# Core Orchestration API boundary

Core public commands, queries, and Snapshot operations are an orchestration API, not a general UI/admin or storage API. Consumers may use their own storage access or projections for non-orchestration views, while mutations that affect Core invariants, lifecycle facts, or whole-Portfolio contents must go through Core commands or Snapshot restore so Core remains the authority for reusable Portfolio orchestration behavior. Snapshot export and restore live under their own Core API namespace because they operate on the whole currently-open Portfolio rather than one orchestration command target.

The current public query surface is limited to orchestration-derived work-state queries for Delivery Work State and Slice Work State. Raw CRUD-style record read/list queries stay outside the public Core API because they are projection and storage-view concerns for Consumers.
