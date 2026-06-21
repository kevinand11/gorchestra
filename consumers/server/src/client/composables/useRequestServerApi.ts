import { useRequestHeaders, useRequestURL } from 'nuxt/app'

import { createServerApi } from './useServerApi'

export function useRequestServerApi() {
	if (typeof window !== 'undefined') return createServerApi()

	const url = useRequestURL()
	const headers = useRequestHeaders(['cookie'])
	return createServerApi({
		baseURL: `${url.protocol}//${url.host}/api`,
		...(typeof headers.cookie === 'string' ? { headers: { cookie: headers.cookie } } : {}),
	})
}
