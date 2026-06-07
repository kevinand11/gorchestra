# File storage first with Equipped ORM

Gorchestra v1 starts with file storage through the Equipped ORM abstraction so the product can reach a complete functional v1 before committing to a database backend. This supersedes the earlier SQLite-first idea; Equipped keeps the persistence boundary portable so later storage backends can include in-memory, MongoDB, or Postgres.
