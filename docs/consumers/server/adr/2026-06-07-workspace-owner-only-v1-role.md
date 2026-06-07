# Workspace Owner as the only v1 role

Gorchestra v1 models Workspace Owner as the only Workspace role, and Workspace Owner assignments are retained as historical facts and revoked rather than deleted. Every Workspace must always have at least one Active Workspace Owner, and operations that would violate this invariant are rejected. We chose this over introducing admin, member, viewer, or full RBAC roles because ownership is the only role needed for v1 safety invariants and privileged operations; additional roles can be introduced later when permission needs are concrete.
