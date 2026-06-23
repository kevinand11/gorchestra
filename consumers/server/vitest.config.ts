import { fileURLToPath } from 'node:url'

import { defineConfig } from 'vitest/config'

export default defineConfig({
	resolve: {
		alias: [{ find: 'nuxt/app', replacement: fileURLToPath(new URL('./src/client/testing/nuxt-app-stub.ts', import.meta.url)) }],
	},
	test: {
		include: ['src/**/*.{test,spec}.ts'],
		includeSource: ['src/**/*.ts'],
		exclude: ['node_modules/**', 'dist/**', 'coverage/**'],
		pool: 'threads',
	},
})
