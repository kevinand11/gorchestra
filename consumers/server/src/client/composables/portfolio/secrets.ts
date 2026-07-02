import { computed, type Ref } from 'vue'

import { SecretCreationFormDraft } from '../../forms/secret'
import { useSelectedPortfolio } from '../auth/session'
import { useApiAction, useFetchAction } from '../core/action-state'
import { useOverlay } from '../core/overlay'
import { useQueryCache } from '../core/query-cache'
import { useServerApi, type ServerApi } from '../core/server-api'

type ListedSecret = Awaited<ReturnType<ServerApi['listSecrets']>>[number]
type SecretDetails = Awaited<ReturnType<ServerApi['getSecret']>>
type CreatedSecret = Awaited<ReturnType<ServerApi['createSecret']>>

type SecretsCreateOptions = {
	onSuccess?: (secret: CreatedSecret) => void | Promise<void>
}

export function useSecretsList() {
	const serverApi = useServerApi()
	const { portfolio } = useSelectedPortfolio()
	const { queryKeys } = useQueryCache()
	const {
		data: secrets,
		isLoading: isLoadingSecrets,
		error: secretsError,
		hasExecuted: hasLoadedSecrets,
		execute: refreshSecrets,
		reset: resetSecrets,
	} = useFetchAction(() => serverApi.listSecrets(), {
		queryKey: queryKeys.portfolio.secrets(portfolio.value.id),
		initialData: [] as ListedSecret[],
	})
	const isRefreshingSecrets = computed(() => isLoadingSecrets.value && hasLoadedSecrets.value)

	return { secrets, isLoadingSecrets, secretsError, hasLoadedSecrets, isRefreshingSecrets, refreshSecrets, resetSecrets }
}

export function useSecretDetail(secretId: Ref<string>) {
	const serverApi = useServerApi()
	const { portfolio } = useSelectedPortfolio()
	const { queryKeys } = useQueryCache()
	const {
		data: secret,
		isLoading: isLoadingSecret,
		error: secretError,
		hasExecuted: hasLoadedSecret,
		execute: refreshSecret,
		reset: resetSecret,
	} = useFetchAction(() => serverApi.getSecret(secretId.value), {
		queryKey: queryKeys.portfolio.secret(portfolio.value.id, secretId.value),
		initialData: null as SecretDetails | null,
	})
	const isRefreshingSecret = computed(() => isLoadingSecret.value && hasLoadedSecret.value)

	return { secret, isLoadingSecret, secretError, hasLoadedSecret, isRefreshingSecret, refreshSecret, resetSecret }
}

export function useSecretsCreate(options: SecretsCreateOptions = {}) {
	const serverApi = useServerApi()
	const { toast } = useOverlay()
	const queryCache = useQueryCache()
	const { portfolio } = useSelectedPortfolio()
	const secretCreationForm = new SecretCreationFormDraft()
	const { queryKeys } = queryCache
	const {
		isLoading: isCreatingSecret,
		error: createSecretError,
		execute: createSecret,
		reset: resetCreateSecret,
	} = useApiAction(async () => {
		const secret = await serverApi.createSecret(secretCreationForm.toModel())
		queryCache.set(queryKeys.portfolio.secret(portfolio.value.id, secret.id), secret)
		queryCache.invalidate(queryKeys.portfolio.secrets(portfolio.value.id), { exact: true })
		toast.success({ title: 'Secret created.', body: secret.name })
		await options.onSuccess?.(secret)
		return secret
	})

	return { secretCreationForm, isCreatingSecret, createSecretError, createSecret, resetCreateSecret }
}

export function useActiveSecretSelectOptions() {
	const secretsList = useSecretsList()
	const activeSecrets = computed(() => secretsList.secrets.value.filter((secret) => !secret.archived))
	const activeSecretOptions = computed(() => activeSecrets.value.map((secret) => ({ value: secret.id, label: secret.name })))

	return { ...secretsList, activeSecrets, activeSecretOptions }
}
