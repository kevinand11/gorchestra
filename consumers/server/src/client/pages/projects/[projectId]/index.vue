<script setup lang="ts">
definePageMeta({
	middleware: ['has-selection', (to) => `/projects/${to.params.projectId}/deliveries`],
})
</script>
