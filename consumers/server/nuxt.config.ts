const apiHost = process.env.GORCHESTRA_API_HOST ?? '127.0.0.1'
const apiPort = process.env.GORCHESTRA_API_PORT ?? '3001'
const apiBaseUrl = `http://${apiHost}:${apiPort}`

type ServerNuxtConfig = {
	compatibilityDate: string
	srcDir: string
	devtools: { enabled: boolean }
	app: { head: { title: string; meta: { name: string; content: string }[] } }
	routeRules: Record<string, { proxy: string }>
}

const config: ServerNuxtConfig = {
	compatibilityDate: '2026-06-18',
	srcDir: 'src/client',
	devtools: { enabled: false },
	app: {
		head: {
			title: 'Gorchestra',
			meta: [{ name: 'description', content: 'Goal-oriented delivery orchestration' }],
		},
	},
	routeRules: {
		'/api/**': { proxy: `${apiBaseUrl}/api/**` },
	},
}

export default config
