<template>
	<OverlayToastStack v-if="requests.length === 0" />
	<Teleport to="body">
		<OverlayRequestDialog
			v-for="(request, index) in requests"
			:key="request.id"
			:request="request"
			:is-top="index === requests.length - 1" />
	</Teleport>
</template>

<script setup lang="ts">
import { onBeforeUnmount } from 'vue'

import { useOverlayShelf } from '../../composables/core/overlay'
import OverlayRequestDialog from './OverlayRequestDialog.vue'
import OverlayToastStack from './OverlayToastStack.vue'

const { requests, cancelAllRequests } = useOverlayShelf()

onBeforeUnmount(cancelAllRequests)
</script>
