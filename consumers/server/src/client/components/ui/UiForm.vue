<template>
	<form v-bind="$attrs" class="grid gap-3">
		<slot />
	</form>
</template>

<script setup lang="ts">
defineOptions({ inheritAttrs: false })
</script>
