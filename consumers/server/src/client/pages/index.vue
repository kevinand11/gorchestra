<script setup lang="ts">
import { useAuthState } from '../composables/auth-state'

definePageMeta({
	middleware: [
		async () => {
			return await useAuthState()
				.getHomePath()
				.catch(() => '/sign-in')
		},
	],
})
</script>
