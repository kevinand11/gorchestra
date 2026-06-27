<template>
	<main class="min-h-screen bg-canvas text-body">
		<section class="min-h-screen w-full overflow-hidden border border-dimmer bg-body-contrast">
			<header
				v-if="props.topbar !== false && hasAnySlot($slots['topbar-left'], $slots['topbar-center'], $slots['topbar-right'])"
				class="grid min-h-[50px] gap-2 border-b border-dimmer bg-card px-3 py-2 lg:items-center"
				:class="
					topbarGridClass(
						$slots['topbar-left'] !== undefined,
						$slots['topbar-center'] !== undefined,
						$slots['topbar-right'] !== undefined,
					)
				">
				<div v-if="$slots['topbar-left']" class="min-w-0">
					<slot name="topbar-left" />
				</div>
				<div v-if="$slots['topbar-center']" class="min-w-0">
					<slot name="topbar-center" />
				</div>
				<div v-if="$slots['topbar-right']" class="min-w-0 justify-self-start lg:justify-self-end">
					<slot name="topbar-right" />
				</div>
			</header>

			<div class="grid min-h-[calc(100vh-67px)]" :class="shellGridClass($slots.left !== undefined, $slots.right !== undefined)">
				<aside v-if="$slots.left" class="min-w-0 border-b border-dimmer lg:border-r lg:border-b-0">
					<slot name="left" />
				</aside>

				<section class="min-w-0">
					<slot />
				</section>

				<aside v-if="$slots.right" class="min-w-0 border-t border-dimmer lg:border-t-0 lg:border-l">
					<slot name="right" />
				</aside>
			</div>
		</section>
	</main>
</template>

<script setup lang="ts">
type SlotPresence = unknown

const props = withDefaults(defineProps<{ topbar?: boolean }>(), { topbar: true })

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

function hasAnySlot(...slots: SlotPresence[]): boolean {
	return slots.some((slot) => slot !== undefined)
}

function topbarGridClass(hasLeft: boolean, hasCenter: boolean, hasRight: boolean) {
	return topbarGridClasses[booleanKey(hasLeft, hasCenter, hasRight)]
}

function shellGridClass(hasLeft: boolean, hasRight: boolean) {
	return shellGridClasses[booleanKey(hasLeft, hasRight)]
}

function booleanKey(...values: boolean[]): string {
	return values.map(Number).join('')
}
</script>
