import tailwindcss from '@tailwindcss/vite'
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
	css: ['~/assets/css/main.css'],
	nitro: {
		preset: 'node',
		serveStatic: true,
	},
	vite: {
		plugins: [tailwindcss()],
		optimizeDeps: {
			include: ['axios', 'valleyed'],
		},
	},
}) as NuxtConfig
