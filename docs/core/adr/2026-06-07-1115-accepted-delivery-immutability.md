# Accepted Delivery immutability

A Delivery is materialized by accepting a Plan Output, and its execution-shaping facts are immutable after acceptance. This includes its target Project/Repository, Target Branch, Slices, Slice parentage, dependencies, and accepted artifact content that shapes execution. Non-execution display metadata such as title or description may be corrected through separate correction facts. We choose this split to preserve execution provenance and stable scheduling while still allowing harmless presentation corrections.
