# Core Orchestration API boundary

Core public commands and queries are an orchestration API, not a general UI/admin or storage API. Consumers may use their own storage access or projections for non-orchestration views, while mutations that affect Core invariants or lifecycle facts must go through Core commands so Core remains the authority for reusable Portfolio orchestration behavior.
