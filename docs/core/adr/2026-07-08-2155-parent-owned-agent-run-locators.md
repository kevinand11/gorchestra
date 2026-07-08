# Parent artifacts store Agent Run locators without embedding Agent Runs

Plans and Revision Gates store the id of the interactive Agent Run they create, while Agent Runs continue to store their purpose context such as `planning.planId` or `revision-planning.revisionGateId`. Core Plan and Revision Gate result shapes return the parent artifact and no longer embed Agent Run records; Consumers load Agent Runs through the standalone Agent Run read surface when they need runtime state or transcript interaction. This intentionally duplicates the relationship so parent surfaces can carry an Agent Run locator without read-time Agent Run joins, while Agent Run runtime behavior remains self-describing through Agent Run Purpose.

## Consequences

- `Plan.agentRunId` and `RevisionGate.agentRunId` are immutable parent-owned locators created atomically with the corresponding interactive Agent Run.
- Direct parent reads do not validate the referenced Agent Run; Agent Run reads, transcript reads, and lifecycle operations own Agent Run failures.
- No compatibility migration is provided for existing local development data; existing Plan and Revision Gate records must be patched with their associated Agent Run ids.
