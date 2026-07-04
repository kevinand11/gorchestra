# Monorepo with single published package

Gorchestra uses a pnpm monorepo so internal architecture can remain modular while users install and run a single product package: `gorchestra`. The stable direction is a reusable orchestration core under `libs/*` plus v1 consumer apps under `consumers/*`; the Server Consumer package lives at `consumers/server` as private `@gorchestra/consumer-server`. Internal package boundaries remain provisional and may be split or reshaped as the design deepens.
