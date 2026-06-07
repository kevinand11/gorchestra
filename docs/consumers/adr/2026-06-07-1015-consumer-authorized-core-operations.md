# Consumer-authorized core operations

Gorchestra core exposes Portfolio operations and enforces core invariants, but Consumers authorize actors before calling those operations. This applies broadly to operations such as export, import, accepting or rejecting Plan Outputs, shipping, and abandoning Deliveries. Keeping authorization in Consumers lets the same core support the Server Consumer's Workspace-based authority model and future consumers with different authority models, without embedding app-specific roles or tenancy concepts in core.
