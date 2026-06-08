# Isolated Agent Run Sandboxes

Each Agent Run owns an isolated Agent Run Sandbox for its work. Agent Runs do not implicitly share sandbox state, even when they belong to the same Execution. Cross-Agent Run state must be promoted by Gorchestra evaluation before it can become input to later Agent Runs, a Slice Artifact, or a Delivery Artifact. This keeps intelligence-generated artifacts reviewable and prevents one Agent Run's unvalidated sandbox changes from silently leaking into another Agent Run.
