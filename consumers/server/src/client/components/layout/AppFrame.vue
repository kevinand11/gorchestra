<template>
	<main class="min-h-screen bg-canvas text-body">
		<section class="min-h-screen w-full overflow-hidden border border-dimmer bg-body-contrast">
			<header
				v-if="props.topbar !== false && hasTopbarContent"
				class="grid min-h-[50px] gap-2 border-b border-dimmer bg-card px-3 py-2 lg:items-center"
				:class="topbarGridClass">
				<div v-if="hasTopbarLeft" class="min-w-0">
					<slot name="topbar-left" />
				</div>
				<div v-if="hasTopbarCenter" class="min-w-0">
					<slot name="topbar-center" />
				</div>
				<div v-if="hasTopbarRight" class="min-w-0 justify-self-start lg:justify-self-end">
					<slot name="topbar-right" />
				</div>
			</header>

			<div class="grid min-h-[calc(100vh-67px)]" :class="shellGridClass">
				<aside v-if="hasLeft" class="min-w-0 border-b border-dimmer lg:border-r lg:border-b-0">
					<slot name="left" />
				</aside>

				<section class="min-w-0">
					<slot />
				</section>

				<aside v-if="hasRight" class="min-w-0 border-t border-dimmer lg:border-t-0 lg:border-l">
					<slot name="right" />
				</aside>
			</div>
		</section>
	</main>
</template>

<script setup lang="ts">
const props = withDefaults(defineProps<{ topbar?: boolean }>(), { topbar: true })
const slots = useSlots()

const hasTopbarLeft = computed(() => slots['topbar-left'] !== undefined)
const hasTopbarCenter = computed(() => slots['topbar-center'] !== undefined)
const hasTopbarRight = computed(() => slots['topbar-right'] !== undefined)
const hasTopbarContent = computed(() => hasTopbarLeft.value || hasTopbarCenter.value || hasTopbarRight.value)
const hasLeft = computed(() => slots.left !== undefined)
const hasRight = computed(() => slots.right !== undefined)

const topbarGridClass = computed(() => topbarGridClasses[booleanKey(hasTopbarLeft.value, hasTopbarCenter.value, hasTopbarRight.value)])
const shellGridClass = computed(() => shellGridClasses[booleanKey(hasLeft.value, hasRight.value)])

const topbarGridClasses: Record<string, string> = {
	'000': 'grid-cols-1',
	'001': 'grid-cols-1',
	'010': 'grid-cols-1',
	'011': 'lg:grid-cols-[minmax(260px,1fr)_auto]',
	'100': 'grid-cols-1',
	'101': 'lg:grid-cols-[auto_1fr]',
	'110': 'lg:grid-cols-[auto_minmax(260px,1fr)]',
	'111': 'lg:grid-cols-[auto_minmax(260px,1fr)_auto]',
}

const shellGridClasses: Record<string, string> = {
	'00': 'grid-cols-1',
	'01': 'lg:grid-cols-[minmax(0,1fr)_360px]',
	'10': 'lg:grid-cols-[235px_minmax(0,1fr)]',
	'11': 'lg:grid-cols-[235px_minmax(0,1fr)_340px]',
}

function booleanKey(...values: boolean[]): string {
	return values.map(Number).join('')
}
</script>
