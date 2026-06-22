<template>
	<DefaultLayout>
		<template #topbar-left>
			<slot name="topbar-left">
				<NuxtLink to="/" class="flex min-w-0 items-center gap-2 text-body no-underline">
					<span class="grid size-[26px] shrink-0 place-items-center border border-dimmer bg-canvas text-body">
						<GorchestraMark :size="18" />
					</span>
					<span class="truncate font-semibold">Gorchestra</span>
				</NuxtLink>
			</slot>
		</template>

		<template #topbar-center>
			<slot name="topbar-center">
				<div class="border border-dimmer bg-canvas px-2.5 py-1.5 text-sz-helper text-dim">
					{{ props.topbarSearchLabel }}
				</div>
			</slot>
		</template>

		<template #topbar-right>
			<slot name="topbar-right">
				<div class="flex items-center justify-end gap-2">
					<UiButton type="button" variant="secondary" :loading="isLoggingOut" @click="logout()">Sign out</UiButton>
				</div>
				<p v-if="logoutError" class="mt-1 text-right text-sz-helper text-error">{{ logoutError }}</p>
			</slot>
		</template>

		<template #left>
			<slot name="left">
				<div class="border-b border-dimmer px-3 py-2 font-semibold">Selected Portfolio</div>
				<div class="flex items-start justify-between gap-2 border-b border-dimmer px-3 py-2">
					<div class="min-w-0">
						<strong class="block truncate font-semibold">{{ portfolioName }}</strong>
						<p class="m-0 truncate text-sz-helper text-dim">{{ workspaceName }}</p>
					</div>
					<NuxtLink
						to="/select"
						class="shrink-0 border border-dimmer bg-secondary px-2 py-1 text-sz-micro font-semibold text-secondary-contrast no-underline hover:border-primary">
						Change
					</NuxtLink>
				</div>
				<nav class="grid gap-1 p-2" aria-label="Selected Portfolio navigation">
					<NuxtLink
						to="/projects"
						class="flex min-h-8 items-center justify-between gap-2 px-2 py-1.5 text-sz-helper font-semibold text-dim no-underline hover:bg-secondary hover:text-body"
						:class="isProjectsRoute ? 'bg-secondary text-body' : ''">
						<span>Projects</span>
					</NuxtLink>
					<NuxtLink
						to="/secrets"
						class="flex min-h-8 items-center justify-between gap-2 px-2 py-1.5 text-sz-helper font-semibold text-dim no-underline hover:bg-secondary hover:text-body"
						:class="isSecretsRoute ? 'bg-secondary text-body' : ''">
						<span>Secrets</span>
					</NuxtLink>
				</nav>
			</slot>
		</template>

		<slot name="main-header" />
		<slot />

		<template v-if="$slots.right" #right>
			<slot name="right" />
		</template>
	</DefaultLayout>
</template>

<script setup lang="ts">
import GorchestraMark from '../components/layout/GorchestraMark.vue'
import UiButton from '../components/ui/UiButton.vue'
import { useApiAction } from '../composables/action-state'
import { useSessionStore } from '../stores/session'
import DefaultLayout from './default.vue'

const props = withDefaults(defineProps<{ topbarSearchLabel?: string }>(), {
	topbarSearchLabel: 'Search Projects, Repositories, Secrets, Deliveries…',
})

const route = useRoute()
const sessionStore = useSessionStore()
const selection = computed(() => (sessionStore.selection?.selected === true ? sessionStore.selection : null))
const workspaceName = computed(() => selection.value?.workspace.displayName ?? 'Workspace')
const portfolioName = computed(() => selection.value?.portfolio.displayName ?? 'Portfolio')
const isProjectsRoute = computed(() => route.path === '/projects' || route.path.startsWith('/projects/'))
const isSecretsRoute = computed(() => route.path === '/secrets' || route.path.startsWith('/secrets/'))

const {
	isLoading: isLoggingOut,
	error: logoutError,
	execute: logout,
} = useApiAction(async () => {
	await sessionStore.logout()
	if (typeof window !== 'undefined') window.location.assign('/sign-in')
	else await navigateTo('/sign-in')
})
</script>
