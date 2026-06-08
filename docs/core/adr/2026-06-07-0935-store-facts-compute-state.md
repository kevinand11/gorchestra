# Store facts, compute state

Gorchestra core stores durable facts and computes lifecycle/display state from those facts wherever practical. This applies across Portfolio orchestration concepts such as Plans, Deliveries, Slices, Current Memories, Links, Actions, and Agent Runs; stored state should be used only when the state itself is an irreducible fact rather than a derivable summary.
