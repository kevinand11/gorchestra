# Core TODO

Durable follow-up items that are known but intentionally deferred.

## Delivery work ownership and runtime follow-ups

- Move same-Delivery worker exclusion into Core with a Core-owned Delivery work lease. The near-term scheduler/consumer runtime must ensure only one worker processes a Delivery at a time, but this should not remain a consumer discipline requirement.
- Define preflight behavior for resumed incomplete Agent Runs whose stored Model differs from the current selected execution Model. The likely direction is claim-specific preflight that checks the AgentRun's stored Model for resumed work and the current selected execution Model for new Agent Runs.
- Allow Delivery Artifact, Slice Artifact, and Slice Delivery Artifact validation to run user-configured validation scripts in the future; until then, these validation gates record passing no-op Validation Evidence instead of executing external checks.
- Observe current Delivery and Slice Review Surfaces during awaiting-review work so merged or closed external review outcomes are recorded instead of returning no observed change.
- Add a dedicated Core storage audit that reads all Core storage records, validates them against Core-owned schemas, and reports sanitized aggregate storage validation and consistency failures outside top-level Core preflight.
