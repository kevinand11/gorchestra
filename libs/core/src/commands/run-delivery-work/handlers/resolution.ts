import type { Id } from '../../../domain/commons'
import {
	portfolioConfigRecordPipe,
	type DeliveryWorkConfig,
	type PortfolioConfigRecord,
	type ProjectConfigRecord,
} from '../../../domain/config'
import type { Delivery } from '../../../domain/delivery'
import { projectPipe, type Project } from '../../../domain/project'
import type { CoreStorageTransaction } from '../../../services'
import type { Result } from '../../../utils/types'
import { getRequired, getRequiredSingleton, validateSelectableModels } from '../../storage-utils'
import type { DeliveryWorkResolution, RunDeliveryWorkResolutionError } from '../types'

export async function resolveDeliveryWork(
	tx: CoreStorageTransaction,
	delivery: Delivery,
): Promise<Result<DeliveryWorkResolution, RunDeliveryWorkResolutionError>> {
	const configResult = await getDeliveryConfigFacts(tx, delivery)
	if (!configResult.ok) return configResult

	const modelId = resolveExecutionModelId(delivery, configResult.value.project, configResult.value.portfolioConfig)
	const modelValidation = await validateSelectableModels(tx, [modelId])
	if (!modelValidation.ok) return modelValidation

	const workConfig = resolveDeliveryWorkConfig(delivery, configResult.value.project.config, configResult.value.portfolioConfig)
	if (workConfig === null) return unresolvedDeliveryWorkConfig()

	return { ok: true, value: { modelId, workConfig } }
}

async function getDeliveryConfigFacts(
	tx: CoreStorageTransaction,
	delivery: Delivery,
): Promise<Result<{ project: Project; portfolioConfig: PortfolioConfigRecord }, RunDeliveryWorkResolutionError>> {
	const projectResult = await getRequired('project', tx.projects, delivery.projectId, projectPipe)
	if (!projectResult.ok) return projectResult

	const portfolioConfigResult = await getRequiredSingleton('portfolio-config', tx.portfolioConfig, portfolioConfigRecordPipe)
	if (!portfolioConfigResult.ok) return portfolioConfigResult

	return { ok: true, value: { project: projectResult.value, portfolioConfig: portfolioConfigResult.value } }
}

function unresolvedDeliveryWorkConfig(): Result<never, RunDeliveryWorkResolutionError> {
	return { ok: false, error: { type: 'not-implemented', operation: 'runDeliveryWork.delivery-work-config-unresolved' } }
}

function resolveExecutionModelId(delivery: Delivery, project: Project, portfolioConfig: PortfolioConfigRecord): Id {
	return firstPresent([
		delivery.config?.value?.model?.executionModelId,
		project.config?.value?.model?.executionModelId,
		portfolioConfig.value.model.executionModelId,
		portfolioConfig.value.model.defaultModelId,
	])
}

function resolveDeliveryWorkConfig(
	delivery: Delivery,
	projectConfig: ProjectConfigRecord | null,
	portfolioConfig: PortfolioConfigRecord,
): DeliveryWorkConfig | null {
	return firstOptional([delivery.config?.value?.work, projectConfig?.value?.work, portfolioConfig.value.work])
}

function firstPresent<T>(values: Array<T | null | undefined>): T {
	const value = values.find((candidate): candidate is T => candidate !== null && candidate !== undefined)
	if (value === undefined) throw new Error('Expected at least one required fallback value.')

	return value
}

function firstOptional<T>(values: Array<T | null | undefined>): T | null {
	return values.find((candidate): candidate is T => candidate !== null && candidate !== undefined) ?? null
}
