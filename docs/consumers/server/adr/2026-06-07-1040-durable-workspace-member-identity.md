# Durable Workspace Member identity

A Workspace Member is a durable workspace-local identity for a global User, and leaving or rejoining a Workspace reuses the same Workspace Member. Membership is tracked with historical periods rather than a mutable status field so Active Member and Inactive Member can be computed while preserving attribution and membership history.
