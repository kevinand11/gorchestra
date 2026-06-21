type ServerNuxtConfig = {
	compatibilityDate: string
	srcDir: string
	ssr: boolean
	devtools: { enabled: boolean }
	app: { head: { title: string; meta: { name: string; content: string }[] } }
	modules: string[]
	nitro: { preset: string; serveStatic: boolean }
}

const config: ServerNuxtConfig = {
	compatibilityDate: '2026-06-18',
	srcDir: 'src/client',
	ssr: false,
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
}

export default config
