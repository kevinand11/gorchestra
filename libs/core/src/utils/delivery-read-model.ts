import type { Result as CoreResult } from './types'
import type { Delivery, DeliveryReadModel, DeliveryReadTarget } from '../domain/delivery'
import type { Repository } from '../domain/repository'
import type { Slice } from '../domain/slice'
import type { ResourceNotFoundError } from '../errors'
import { notFound } from './storage/helpers'

export function deliveryReadModels(
	deliveries: Delivery[],
	repositories: Repository[],
	slicesByDeliveryId: Map<string, Slice[]>,
): CoreResult<DeliveryReadModel[], ResourceNotFoundError> {
	const repositoriesById = new Map(repositories.map((repository) => [repository.id, repository]))
	const models: DeliveryReadModel[] = []
	for (const delivery of deliveries) {
		const model = deliveryReadModel(delivery, repositoriesById, slicesByDeliveryId.get(delivery.id) ?? [])
		if (!model.ok) return model
		models.push(model.value)
	}

	return { ok: true, value: models }
}

export function deliveryReadModel(
	delivery: Delivery,
	repositoriesById: Map<string, Repository>,
	slices: Slice[],
): CoreResult<DeliveryReadModel, ResourceNotFoundError> {
	const { target: _target, ...deliveryFields } = delivery
	const target = deliveryReadTarget(delivery.target, repositoriesById)
	return target.ok ? { ok: true, value: { ...deliveryFields, target: target.value, slices } } : target
}

function deliveryReadTarget(
	target: Delivery['target'],
	repositoriesById: Map<string, Repository>,
): CoreResult<DeliveryReadTarget, ResourceNotFoundError> {
	switch (target.type) {
		case 'source-control': {
			const repository = repositoriesById.get(target.repositoryId)
			return repository === undefined
				? notFound('repository', target.repositoryId)
				: { ok: true, value: { type: 'source-control', repository, targetBranch: target.targetBranch } }
		}
	}
}
