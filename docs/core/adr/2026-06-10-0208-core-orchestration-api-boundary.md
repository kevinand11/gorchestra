# Core Orchestration API boundary

Core public commands and queries are an orchestration API, not a general UI/admin or storage API. Consumers may use their own storage access or projections for non-orchestration views, while mutations that affect Core invariants or lifecycle facts must go through Core commands so Core remains the authority for reusable Portfolio orchestration behavior.

The current public query surface is limited to orchestration-derived work-state queries for Delivery Work State and Slice Work State. Raw CRUD-style record read/list queries stay outside the public Core API because they are projection and storage-view concerns for Consumers.
