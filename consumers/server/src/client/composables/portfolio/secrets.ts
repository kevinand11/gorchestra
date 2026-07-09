import { computed, type Ref } from 'vue'

import { SecretCreationFormDraft, SecretMetadataFormDraft, SecretValueReplacementFormDraft } from '../../forms/secret'
import { useSelectedPortfolio } from '../auth/session'
import { useApiAction, useFetchAction } from '../core/action-state'
import { useOverlay } from '../core/overlay'
import { usePaginatedFetchAction } from '../core/paginated-fetch-action'
import { useQueryCache } from '../core/query-cache'
import { useServerApi, type ServerApi } from '../core/server-api'

type SecretDetails = Awaited<ReturnType<ServerApi['getSecret']>>
type CreatedSecret = Awaited<ReturnType<ServerApi['createSecret']>>
type SecretLifecycleAction = 'archive' | 'unarchive'

type SecretsCreateOptions = {
	onSuccess?: (secret: CreatedSecret) => void | Promise<void>
}

type SecretMutationOptions = {
	onSuccess?: (secret: SecretDetails) => void | Promise<void>
}

type SecretLifecycleOptions = {
	onSuccess?: (secret: SecretDetails, action: SecretLifecycleAction) => void | Promise<void>
}

export function useSecretsList() {
	const serverApi = useServerApi()
	const { portfolio } = useSelectedPortfolio()
	const { queryKeys } = useQueryCache()
	const {
		items: secrets,
		isLoading: isLoadingSecrets,
		error: secretsError,
		hasExecuted: hasLoadedSecrets,
		fetchNext: fetchNextSecrets,
		hasNext: hasNextSecrets,
	} = usePaginatedFetchAction((input) => serverApi.listSecrets(input), {
		queryKey: queryKeys.portfolio.secrets(portfolio.value.id),
	})
	const isRefreshingSecrets = computed(() => isLoadingSecrets.value && hasLoadedSecrets.value)

	return { secrets, isLoadingSecrets, secretsError, hasLoadedSecrets, isRefreshingSecrets, fetchNextSecrets, hasNextSecrets }
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
	const {
		isLoading: isCreatingSecret,
		error: createSecretError,
		execute: createSecret,
		reset: resetCreateSecret,
	} = useApiAction(async () => {
		const secret = await serverApi.createSecret(secretCreationForm.toModel())
		updateSecretCaches(queryCache, portfolio.value.id, secret)
		toast.success({ title: 'Secret created.', body: secret.name })
		await options.onSuccess?.(secret)
		return secret
	})

	return { secretCreationForm, isCreatingSecret, createSecretError, createSecret, resetCreateSecret }
}

export function useSecretMetadataUpdate(secretId: Ref<string>, options: SecretMutationOptions = {}) {
	const serverApi = useServerApi()
	const { toast } = useOverlay()
	const queryCache = useQueryCache()
	const { portfolio } = useSelectedPortfolio()
	const secretMetadataForm = new SecretMetadataFormDraft()
	const {
		isLoading: isUpdatingSecretMetadata,
		error: updateSecretMetadataError,
		execute: updateSecretMetadata,
		reset: resetUpdateSecretMetadata,
	} = useApiAction(async () => {
		const secret = await serverApi.updateSecretMetadata(secretId.value, secretMetadataForm.toModel())
		updateSecretCaches(queryCache, portfolio.value.id, secret)
		toast.success({ title: 'Secret metadata saved.', body: secret.name })
		await options.onSuccess?.(secret)
		return secret
	})

	return { secretMetadataForm, isUpdatingSecretMetadata, updateSecretMetadataError, updateSecretMetadata, resetUpdateSecretMetadata }
}

export function useSecretValueReplacement(secretId: Ref<string>, options: SecretMutationOptions = {}) {
	const serverApi = useServerApi()
	const { toast } = useOverlay()
	const queryCache = useQueryCache()
	const { portfolio } = useSelectedPortfolio()
	const secretValueReplacementForm = new SecretValueReplacementFormDraft()
	const {
		isLoading: isReplacingSecretValue,
		error: replaceSecretValueError,
		execute: replaceSecretValue,
		reset: resetReplaceSecretValue,
	} = useApiAction(async () => {
		const secret = await serverApi.replaceSecretValue(secretId.value, secretValueReplacementForm.toModel())
		secretValueReplacementForm.reset()
		updateSecretCaches(queryCache, portfolio.value.id, secret)
		toast.success({ title: 'Secret value replaced.', body: secret.name })
		await options.onSuccess?.(secret)
		return secret
	})

	return { secretValueReplacementForm, isReplacingSecretValue, replaceSecretValueError, replaceSecretValue, resetReplaceSecretValue }
}

export function useSecretLifecycleActions(secretId: Ref<string>, options: SecretLifecycleOptions = {}) {
	const serverApi = useServerApi()
	const { toast } = useOverlay()
	const queryCache = useQueryCache()
	const { portfolio } = useSelectedPortfolio()
	const {
		isLoading: isChangingSecretLifecycle,
		error: secretLifecycleError,
		execute: runSecretLifecycle,
		reset: resetSecretLifecycle,
	} = useApiAction(async (action: SecretLifecycleAction) => {
		const secret =
			action === 'archive' ? await serverApi.archiveSecret(secretId.value) : await serverApi.unarchiveSecret(secretId.value)
		updateSecretCaches(queryCache, portfolio.value.id, secret)
		toast.success({ title: action === 'archive' ? 'Secret archived.' : 'Secret unarchived.', body: secret.name })
		await options.onSuccess?.(secret, action)
		return secret
	})

	return { isChangingSecretLifecycle, secretLifecycleError, runSecretLifecycle, resetSecretLifecycle }
}

export function useActiveSecretSelectOptions() {
	const secretsList = useSecretsList()
	const activeSecrets = computed(() => secretsList.secrets.value.filter((secret) => !secret.archived))
	const activeSecretOptions = computed(() => activeSecrets.value.map((secret) => ({ value: secret.id, label: secret.name })))

	return { ...secretsList, activeSecrets, activeSecretOptions }
}

function updateSecretCaches(queryCache: ReturnType<typeof useQueryCache>, portfolioId: string, secret: SecretDetails): void {
	const { queryKeys } = queryCache
	queryCache.set(queryKeys.portfolio.secret(portfolioId, secret.id), secret)
	queryCache.invalidate(queryKeys.portfolio.secrets(portfolioId), { exact: true })
}
