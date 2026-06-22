<template>
	<AppFrame :topbar="topbar">
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

		<template v-if="$slots['topbar-center'] || topbarSubtitle" #topbar-center>
			<slot name="topbar-center">
				<p class="m-0 truncate text-sz-helper text-dim">{{ topbarSubtitle }}</p>
			</slot>
		</template>

		<template v-if="$slots['topbar-right']" #topbar-right>
			<slot name="topbar-right" />
		</template>

		<template v-if="$slots.left" #left>
			<slot name="left" />
		</template>

		<slot />

		<template v-if="$slots.right" #right>
			<slot name="right" />
		</template>
	</AppFrame>
</template>

<script setup lang="ts">
import AppFrame from '../components/layout/AppFrame.vue'
import GorchestraMark from '../components/layout/GorchestraMark.vue'

withDefaults(
	defineProps<{
		topbar?: boolean
		topbarSubtitle?: string
	}>(),
	{ topbar: true, topbarSubtitle: '' },
)
</script>
