<template>
	<main class="shell">
		<section class="hero">
			<p class="eyebrow">Gorchestra Server Consumer</p>
			<h1>Coordinate delivery from one selected Portfolio.</h1>
			<p>
				Sign in with Email OTP, provision your first Workspace when needed, and explicitly select the Workspace and Portfolio you
				want to use.
			</p>
		</section>

		<section v-if="message" class="notice">{{ message }}</section>
		<section v-if="errorMessage" class="error">{{ errorMessage }}</section>

		<section v-if="!isAuthenticated" class="card">
			<h2>Email OTP Sign-in</h2>
			<form class="stack" @submit.prevent="requestEmailOtp">
				<label>
					Email address
					<input v-model="email" type="email" autocomplete="email" required placeholder="person@example.com" />
				</label>
				<button type="submit" :disabled="busy">Send sign-in code</button>
			</form>

			<form v-if="challengeRequested" class="stack" @submit.prevent="verifyEmailOtp">
				<label>
					Six-digit code
					<input v-model="code" inputmode="numeric" autocomplete="one-time-code" required placeholder="123456" />
				</label>
				<button type="submit" :disabled="busy">Verify and sign in</button>
			</form>
		</section>

		<section v-else class="grid">
			<article class="card">
				<div class="row">
					<div>
						<h2>Signed in</h2>
						<p>{{ sessionLabel }}</p>
					</div>
					<button type="button" class="secondary" :disabled="busy" @click="logout">Sign out</button>
				</div>
			</article>

			<article v-if="workspacePortfolios.length === 0" class="card">
				<h2>Provision your first Workspace</h2>
				<p>No accessible Workspace and Portfolio is available yet.</p>
				<form class="stack" @submit.prevent="provisionWorkspace">
					<label>
						Workspace display name
						<input v-model="workspaceDisplayName" required placeholder="Delivery Ops" />
					</label>
					<label>
						Portfolio display name
						<input v-model="portfolioDisplayName" required placeholder="Main Portfolio" />
					</label>
					<button type="submit" :disabled="busy">Create Workspace and select Default Portfolio</button>
				</form>
			</article>

			<article v-else class="card">
				<h2>Workspace and Portfolio selection</h2>
				<p v-if="selection?.selected" class="success">
					Selected {{ selection.workspace.displayName }} / {{ selection.portfolio.displayName }}
				</p>
				<p v-else>Selection required: {{ selection?.reason ?? 'not loaded' }}</p>

				<ul class="portfolio-list">
					<li v-for="access in workspacePortfolios" :key="`${access.workspace.id}:${access.portfolio.id}`">
						<div>
							<strong>{{ access.workspace.displayName }}</strong>
							<span>{{ access.portfolio.displayName }}</span>
						</div>
						<button type="button" :disabled="busy" @click="selectPortfolio(access.workspace.id, access.portfolio.id)">
							Select
						</button>
					</li>
				</ul>

				<button type="button" class="secondary" :disabled="busy || !selection?.selected" @click="clearSelection">
					Clear selection
				</button>
			</article>

			<article v-if="selection?.selected" class="card accent">
				<h2>Ready for Core work</h2>
				<p>
					{{ selection.workspace.displayName }} is selected. Project, Plan, and Delivery views will land after Core read routes
					are added.
				</p>
			</article>
		</section>
	</main>
</template>

<script setup lang="ts">
const api = useServerApi()

const busy = ref(false)
const message = ref('')
const errorMessage = ref('')
const email = ref('')
const code = ref('')
const challengeRequested = ref(false)
const workspaceDisplayName = ref('Delivery Ops')
const portfolioDisplayName = ref('Main Portfolio')
const session = ref<Awaited<ReturnType<typeof api.getSession>> | null>(null)
const workspacePortfolios = ref<Awaited<ReturnType<typeof api.listWorkspacePortfolios>>['workspacePortfolios']>([])
const selection = ref<Awaited<ReturnType<typeof api.getSelection>> | null>(null)

const isAuthenticated = computed(() => session.value?.authenticated === true)
const sessionLabel = computed(() => (session.value?.authenticated ? `${session.value.session.email} (${session.value.tokenStatus})` : ''))

onMounted(refreshAppState)

async function requestEmailOtp(): Promise<void> {
	await runAction(async () => {
		await api.requestEmailOtp(email.value)
		challengeRequested.value = true
		message.value = 'Sign-in code sent. Check the server mail output for the development OTP.'
	})
}

async function verifyEmailOtp(): Promise<void> {
	await runAction(async () => {
		await api.verifyEmailOtpSignIn(email.value, code.value)
		code.value = ''
		challengeRequested.value = false
		message.value = 'Signed in.'
		await refreshAppState()
	})
}

async function provisionWorkspace(): Promise<void> {
	await runAction(async () => {
		await api.provisionDefaultWorkspace({
			workspaceDisplayName: workspaceDisplayName.value,
			portfolioDisplayName: portfolioDisplayName.value,
		})
		message.value = 'Workspace provisioned and Default Portfolio selected.'
		await refreshAppState()
	})
}

async function selectPortfolio(workspaceId: string, portfolioId: string): Promise<void> {
	await runAction(async () => {
		selection.value = await api.setSelection(workspaceId, portfolioId)
		message.value = 'Selection updated.'
	})
}

async function clearSelection(): Promise<void> {
	await runAction(async () => {
		selection.value = await api.clearSelection()
		message.value = 'Selection cleared.'
	})
}

async function logout(): Promise<void> {
	await runAction(async () => {
		await api.logout()
		session.value = { authenticated: false, reason: 'missing-token' }
		workspacePortfolios.value = []
		selection.value = null
		message.value = 'Signed out.'
	})
}

async function refreshAppState(): Promise<void> {
	session.value = await api.getSession()
	if (!session.value.authenticated) {
		workspacePortfolios.value = []
		selection.value = null
		return
	}
	workspacePortfolios.value = (await api.listWorkspacePortfolios()).workspacePortfolios
	selection.value = await api.getSelection()
}

async function runAction(action: () => Promise<void>): Promise<void> {
	busy.value = true
	errorMessage.value = ''
	try {
		await action()
	} catch (error) {
		errorMessage.value = api.errorMessage(error)
	} finally {
		busy.value = false
	}
}
</script>

<style scoped>
:global(body) {
	margin: 0;
	background: #101419;
	color: #e9eef5;
	font-family:
		Inter,
		ui-sans-serif,
		system-ui,
		-apple-system,
		BlinkMacSystemFont,
		'Segoe UI',
		sans-serif;
}

.shell {
	width: min(960px, calc(100vw - 32px));
	margin: 0 auto;
	padding: 56px 0;
}

.hero,
.card,
.notice,
.error {
	border: 1px solid rgb(255 255 255 / 10%);
	border-radius: 24px;
	background: rgb(255 255 255 / 6%);
	box-shadow: 0 24px 70px rgb(0 0 0 / 24%);
}

.hero {
	padding: 40px;
	margin-bottom: 24px;
}

.hero h1 {
	max-width: 760px;
	margin: 0;
	font-size: clamp(2.5rem, 8vw, 5.5rem);
	line-height: 0.92;
	letter-spacing: -0.08em;
}

.hero p:last-child {
	max-width: 660px;
	color: #aebccd;
	font-size: 1.1rem;
}

.eyebrow {
	color: #77ddff;
	font-weight: 700;
	text-transform: uppercase;
	letter-spacing: 0.16em;
}

.grid {
	display: grid;
	gap: 20px;
}

.card,
.notice,
.error {
	padding: 24px;
	margin-bottom: 20px;
}

.accent {
	border-color: rgb(119 221 255 / 35%);
}

.stack {
	display: grid;
	gap: 16px;
	max-width: 520px;
}

.row {
	display: flex;
	gap: 16px;
	align-items: center;
	justify-content: space-between;
}

label {
	display: grid;
	gap: 8px;
	color: #cdd7e3;
	font-weight: 700;
}

input {
	border: 1px solid rgb(255 255 255 / 15%);
	border-radius: 14px;
	padding: 12px 14px;
	background: rgb(0 0 0 / 26%);
	color: #fff;
	font: inherit;
}

button {
	border: 0;
	border-radius: 999px;
	padding: 12px 18px;
	background: #77ddff;
	color: #071016;
	font: inherit;
	font-weight: 800;
	cursor: pointer;
}

button:disabled {
	opacity: 0.5;
	cursor: not-allowed;
}

button.secondary {
	background: rgb(255 255 255 / 12%);
	color: #f8fbff;
}

.notice {
	border-color: rgb(119 221 255 / 40%);
	color: #c5f3ff;
}

.error {
	border-color: rgb(255 123 123 / 42%);
	color: #ffd0d0;
}

.success {
	color: #9effc3;
}

.portfolio-list {
	display: grid;
	gap: 12px;
	padding: 0;
	list-style: none;
}

.portfolio-list li {
	display: flex;
	gap: 12px;
	align-items: center;
	justify-content: space-between;
	border: 1px solid rgb(255 255 255 / 10%);
	border-radius: 18px;
	padding: 14px;
	background: rgb(0 0 0 / 18%);
}

.portfolio-list span {
	display: block;
	color: #aebccd;
}
</style>
