import tailwindcss from '@tailwindcss/vite'
import { defineNuxtConfig, type NuxtConfig } from 'nuxt/config'

export default defineNuxtConfig({
	compatibilityDate: '2026-06-18',
	srcDir: 'src/client',
	devtools: { enabled: false },
	app: {
		head: {
			title: 'Gorchestra',
			meta: [
				{ name: 'description', content: 'Goal-oriented delivery orchestration' },
				{ name: 'theme-color', content: '#060B16' },
				{ name: 'color-scheme', content: 'dark' },
				{ name: 'apple-mobile-web-app-title', content: 'Gorchestra' },
			],
			link: [
				{ rel: 'icon', type: 'image/svg+xml', href: '/favicon.svg' },
				{ rel: 'apple-touch-icon', href: '/app-icon.svg' },
				{ rel: 'mask-icon', href: '/safari-pinned-tab.svg', color: '#B9852E' },
				{ rel: 'manifest', href: '/site.webmanifest' },
			],
		},
	},
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
