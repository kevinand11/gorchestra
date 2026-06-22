export function formatDate(value: string): string {
	return new Intl.DateTimeFormat('en', { dateStyle: 'medium' }).format(new Date(value))
}
