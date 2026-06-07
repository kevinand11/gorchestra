# Monorepo with single published package

Gorchestra uses a pnpm monorepo so internal architecture can remain modular while users install and run a single product package: `gorchestra`. The stable direction is a reusable orchestration core plus one v1 app layer that consumes it; the app layer may be implemented with a meta-framework such as Nuxt rather than separate server and client packages. Internal package boundaries remain provisional and may be split or reshaped as the design deepens.
