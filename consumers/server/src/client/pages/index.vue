<script setup lang="ts">
import { useSessionStore } from '../stores/session'

definePageMeta({
	middleware: [
		async () => {
			const sessionStore = useSessionStore()
			return sessionStore
				.loadAuthenticatedState()
				.then(() => sessionStore.homePath)
				.catch(() => '/sign-in')
		},
	],
})
</script>
