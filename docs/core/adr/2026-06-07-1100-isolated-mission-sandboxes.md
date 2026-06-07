# Isolated Mission Sandboxes

Each Mission owns an isolated Mission Sandbox for its work. Missions do not implicitly share sandbox state, even when they belong to the same Execution. Cross-Mission state must be promoted by Gorchestra evaluation before it can become input to later Missions, a Slice Artifact, or a Delivery Artifact. This keeps intelligence-generated artifacts reviewable and prevents one Mission's unvalidated sandbox changes from silently leaking into another Mission.
