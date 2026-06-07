# Gorchestra-owned lifecycle mutations

Missions perform goal-directed work, but Gorchestra owns authoritative lifecycle and repository mutations such as validating outputs, updating Delivery and Slice state, pushing branches, creating Review Surfaces, and shipping. We chose this boundary so intelligence can propose and perform work without directly controlling the workflow engine or repository integration lifecycle.
