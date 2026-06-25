<template>
	<DefaultLayout>
		<template #topbar-left>
			<slot name="topbar-left">
				<NuxtLink to="/" class="flex min-w-0 items-center gap-2 text-body no-underline">
					<GorchestraMark />
					<span class="truncate font-semibold">Gorchestra</span>
				</NuxtLink>
			</slot>
		</template>

		<template #topbar-center>
			<slot name="topbar-center">
				<div class="border border-dimmer bg-canvas px-2.5 py-1.5 max-w-[400px] mx-auto text-sz-helper text-dim">
					{{ topbarSearchLabel }}
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
				<div class="flex items-center justify-between gap-2 border-b border-dimmer px-3 py-2">
					<div class="min-w-0">
						<strong class="block truncate font-semibold">{{ portfolio.displayName }}</strong>
						<p class="m-0 truncate text-sz-helper text-dim">{{ workspace.displayName }}</p>
					</div>
					<NuxtLink
						to="/select"
						class="shrink-0 border border-dimmer bg-secondary px-2 py-1 text-sz-micro font-semibold text-secondary-contrast no-underline hover:border-primary">
						Change
					</NuxtLink>
				</div>
				<nav class="grid gap-1 p-2" aria-label="Selected Portfolio navigation">
					<NuxtLink
						v-for="{ label, to } in [
							{ label: 'Projects', to: '/projects' },
							{ label: 'Brain', to: '/brain' },
							{ label: 'Secrets', to: '/secrets' },
						]"
						:key="to"
						:to="to"
						class="flex min-h-8 items-center justify-between gap-2 px-2 py-1.5 text-sz-helper font-semibold no-underline"
						:class="route.path.startsWith(to) ? 'bg-secondary text-body' : 'text-dim hover:bg-secondary hover:text-body'">
						<span>{{ label }}</span>
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
import { useAuthState } from '../composables/auth-state'
import { useSelectedPortfolio } from '../composables/selected-portfolio'
import DefaultLayout from './default.vue'

withDefaults(defineProps<{ topbarSearchLabel?: string }>(), {
	topbarSearchLabel: 'Search Projects, Memories, Repositories, Secrets, Deliveries…',
})

const route = useRoute()
const { workspace, portfolio } = useSelectedPortfolio()
const authState = useAuthState()

const { isLoading: isLoggingOut, error: logoutError, execute: logout } = useApiAction(authState.logout)
</script>
