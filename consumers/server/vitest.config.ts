import { defineConfig } from 'vitest/config'

export default defineConfig({
	test: {
		include: ['src/**/*.test.ts'],
		pool: 'forks',
		globals: false,
		fileParallelism: false,
		passWithNoTests: true,
	},
})
