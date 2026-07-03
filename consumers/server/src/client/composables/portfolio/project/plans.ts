import { computed, type Ref } from 'vue'

import { PlanCreationFormDraft } from '../../../forms/plan'
import { useSelectedPortfolio } from '../../auth/session'
import { useApiAction, useFetchAction } from '../../core/action-state'
import { useOverlay } from '../../core/overlay'
import { useQueryCache } from '../../core/query-cache'
import { useServerApi, type ServerApi } from '../../core/server-api'

export type ListedPlan = Awaited<ReturnType<ServerApi['listPlans']>>[number]
type PlanDetails = Awaited<ReturnType<ServerApi['getPlan']>>
type CreatedPlan = Awaited<ReturnType<ServerApi['createPlan']>>
type ClosedPlan = Awaited<ReturnType<ServerApi['closePlan']>>

type PlansCreateOptions = {
	onSuccess?: (plan: CreatedPlan) => void | Promise<void>
}

type PlanCloseOptions = {
	onSuccess?: (plan: ClosedPlan) => void | Promise<void>
}

export function usePlansList(projectId: Ref<string>) {
	const serverApi = useServerApi()
	const { portfolio } = useSelectedPortfolio()
	const { queryKeys } = useQueryCache()
	const {
		data: plans,
		isLoading: isLoadingPlans,
		error: plansError,
		hasExecuted: hasLoadedPlans,
		execute: refreshPlans,
		reset: resetPlans,
	} = useFetchAction(() => serverApi.listPlans(projectId.value), {
		queryKey: queryKeys.portfolio.plans(portfolio.value.id, projectId.value),
		initialData: [] as ListedPlan[],
	})
	const isRefreshingPlans = computed(() => isLoadingPlans.value && hasLoadedPlans.value)

	return { plans, isLoadingPlans, plansError, hasLoadedPlans, isRefreshingPlans, refreshPlans, resetPlans }
}

export function usePlanDetail(projectId: Ref<string>, planId: Ref<string>) {
	const serverApi = useServerApi()
	const { portfolio } = useSelectedPortfolio()
	const queryCache = useQueryCache()
	const { queryKeys } = queryCache
	const {
		data: plan,
		isLoading: isLoadingPlan,
		error: planError,
		hasExecuted: hasLoadedPlan,
		execute: refreshPlan,
		reset: resetPlan,
	} = useFetchAction(() => serverApi.getPlan(projectId.value, planId.value), {
		queryKey: queryKeys.portfolio.plan(portfolio.value.id, projectId.value, planId.value),
		initialData: null as PlanDetails | null,
	})
	const isRefreshingPlan = computed(() => isLoadingPlan.value && hasLoadedPlan.value)

	return { plan, isLoadingPlan, planError, hasLoadedPlan, isRefreshingPlan, refreshPlan, resetPlan }
}

export function usePlanClose(projectId: Ref<string>, planId: Ref<string>, options: PlanCloseOptions = {}) {
	const serverApi = useServerApi()
	const queryCache = useQueryCache()
	const { portfolio } = useSelectedPortfolio()
	const { queryKeys } = queryCache
	const {
		isLoading: isClosingPlan,
		error: closePlanError,
		execute: closePlan,
		reset: resetClosePlan,
	} = useApiAction(async () => {
		const plan = await serverApi.closePlan(projectId.value, planId.value)
		queryCache.set(queryKeys.portfolio.plan(portfolio.value.id, projectId.value, planId.value), plan)
		queryCache.invalidate(queryKeys.portfolio.plans(portfolio.value.id, projectId.value), { exact: true })
		await options.onSuccess?.(plan)
		return plan
	})

	return { isClosingPlan, closePlanError, closePlan, resetClosePlan }
}

export function usePlansCreate(projectId: Ref<string>, options: PlansCreateOptions = {}) {
	const serverApi = useServerApi()
	const { toast } = useOverlay()
	const queryCache = useQueryCache()
	const { portfolio } = useSelectedPortfolio()
	const planCreationForm = new PlanCreationFormDraft()
	const { queryKeys } = queryCache
	const {
		isLoading: isCreatingPlan,
		error: createPlanError,
		execute: createPlan,
		reset: resetCreatePlan,
	} = useApiAction(async () => {
		const plan = await serverApi.createPlan(projectId.value, planCreationForm.toModel())
		queryCache.set(queryKeys.portfolio.plan(portfolio.value.id, projectId.value, plan.id), plan)
		queryCache.invalidate(queryKeys.portfolio.plans(portfolio.value.id, projectId.value), { exact: true })
		toast.success({ title: 'Plan created.', body: plan.title })
		await options.onSuccess?.(plan)
		return plan
	})

	return { planCreationForm, isCreatingPlan, createPlanError, createPlan, resetCreatePlan }
}
