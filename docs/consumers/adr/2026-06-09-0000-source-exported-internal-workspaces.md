# Source-exported internal workspaces

Gorchestra internal packages are private pnpm workspace packages that export TypeScript source files directly instead of requiring a build step. The initial internal package is `@gorchestra/core` at `libs/core`, exported only from its package root, while the future public npm package remains `gorchestra`. We chose this to keep internal package boundaries lightweight and Stranerd-style while preserving the existing single-published-package direction.
