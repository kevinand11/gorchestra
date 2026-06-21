import { defineNuxtConfig, type NuxtConfig } from 'nuxt/config'

export default defineNuxtConfig({
	compatibilityDate: '2026-06-18',
	srcDir: 'src/client',
	devtools: { enabled: false },
	app: {
		head: {
			title: 'Gorchestra',
			meta: [{ name: 'description', content: 'Goal-oriented delivery orchestration' }],
		},
	},
	modules: ['@pinia/nuxt'],
	nitro: {
		preset: 'node',
		serveStatic: true,
	},
	vite: {
		optimizeDeps: {
			include: ['axios'],
		},
	},
}) as NuxtConfig
