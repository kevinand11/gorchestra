# Validation feedback loop

When validation fails during execution, Gorchestra records the validation failure evidence and may provide that evidence as input to a later Mission. The later Mission works in its own isolated Mission Sandbox and attempts to address the failures; Actions then evaluate the new output and rerun validation. This makes validation failures part of the execution feedback loop without giving Missions authoritative state or allowing unvalidated sandbox changes to leak across Missions.
