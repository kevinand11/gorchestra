import { Domain, Queries } from '@gorchestra/core'
import type { Pipe } from 'valleyed'

type ServerResponse<T> = T extends string
	? string
	: T extends readonly (infer Item)[]
		? ServerResponse<Item>[]
		: T extends object
			? { [Key in keyof T]: ServerResponse<T[Key]> }
			: T

export const listProjectsResponsePipe: Pipe<unknown, ServerResponse<Queries.ListProjects.Result>> = Queries.ListProjects.resultPipe
export const projectResponsePipe: Pipe<unknown, ServerResponse<Queries.GetProject.Result>> = Queries.GetProject.resultPipe
export const listPlansResponsePipe: Pipe<unknown, ServerResponse<Queries.ListPlans.Result>> = Queries.ListPlans.resultPipe
export const planResponsePipe: Pipe<unknown, ServerResponse<Queries.GetPlan.Result>> = Queries.GetPlan.resultPipe
export const listDeliveriesResponsePipe: Pipe<unknown, ServerResponse<Queries.ListDeliveries.Result>> = Queries.ListDeliveries.resultPipe
export const deliveryResponsePipe: Pipe<unknown, ServerResponse<Queries.GetDelivery.Result>> = Queries.GetDelivery.resultPipe
export const listRepositoriesResponsePipe: Pipe<unknown, ServerResponse<Queries.ListRepositories.Result>> = Queries.ListRepositories
	.resultPipe
export const repositoryResponsePipe: Pipe<unknown, ServerResponse<Queries.GetRepository.Result>> = Queries.GetRepository.resultPipe
export const listMemoriesResponsePipe: Pipe<unknown, ServerResponse<Queries.ListMemories.Result>> = Queries.ListMemories.resultPipe
export const memoryResponsePipe: Pipe<unknown, ServerResponse<Queries.GetMemory.Result>> = Queries.GetMemory.resultPipe
export const createdMemoryResponsePipe: Pipe<unknown, ServerResponse<Domain.Memory.Memory>> = Domain.Memory.memoryPipe
export const listSecretsResponsePipe: Pipe<unknown, ServerResponse<Queries.ListSecrets.Result>> = Queries.ListSecrets.resultPipe
export const secretResponsePipe: Pipe<unknown, ServerResponse<Queries.GetSecret.Result>> = Queries.GetSecret.resultPipe
export const validationEvidenceResponsePipe: Pipe<unknown, ServerResponse<Domain.Evidence.ValidationEvidence>> = Domain.Evidence
	.validationEvidencePipe
