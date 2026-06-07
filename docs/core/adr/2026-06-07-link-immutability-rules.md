# Link immutability rules

Gorchestra treats some Links as immutable historical facts and others as archivable associations or constraints. `produced`, `supersedes`, and `implements` when materialized as accepted provenance are immutable; `references`, `supports`, `contradicts`, and `depends-on` are archivable. We chose this split to preserve audit history for provenance while still allowing humans and planning work to correct relevance, tension, and scheduling relationships.
