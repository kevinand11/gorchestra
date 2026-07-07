import { FormDraft, FormDraftSelect, nestedFormDraftPipe, type FormDraftArray } from '@gorchestra/form-draft'
import { v } from 'valleyed'

import type {
	AgentRunSandboxConfig,
	AgentRunSandboxNetworkPolicy,
	AgentRunSandboxSourceConfig,
	VercelSandboxRuntime,
} from '../composables/core/server-api'

type VercelCredentialsModel = { tokenSecretId: string; teamIdSecretId: string; projectIdSecretId: string }
type VercelCredentialsFields = {
	tokenSecretId: FormDraftSelect<string>
	teamIdSecretId: FormDraftSelect<string>
	projectIdSecretId: FormDraftSelect<string>
}

type SandboxResourcesFields = { vcpus: number }
type SandboxNetworkPolicyType = AgentRunSandboxNetworkPolicy['type']
type StringListItemFields = { value: string }
type SandboxNetworkPolicyFields = {
	type: SandboxNetworkPolicyType
	hosts: FormDraftArray<StringListItemDraft>
	allowSubnets: FormDraftArray<StringListItemDraft>
	denySubnets: FormDraftArray<StringListItemDraft>
}

type SandboxSourceType = AgentRunSandboxSourceConfig['type']
type SandboxSourceFields = {
	type: SandboxSourceType
	ociImage: string
	runtime: VercelSandboxRuntime
	vcrImage: string
	credentials: VercelSecretCredentialsFormDraft
}

type SandboxConfigFields = {
	source: AgentRunSandboxSourceFormDraft
	resources: AgentRunSandboxResourcesFormDraft
	networkPolicy: AgentRunSandboxNetworkPolicyFormDraft
}

const secretIdPipe = v.string().pipe(v.min<string>(1, 'Select a Secret'))
const sandboxSourceTypePipe = v.in(['consumer-managed', 'vercel-runtime', 'vercel-vcr-image'])
const vercelRuntimePipe = v.in(['node26', 'node24', 'node22', 'python3.13'])
const networkPolicyTypePipe = v.in(['allow-all', 'deny-all', 'allow-list'])
const nonEmptyStringPipe = v.string().pipe(v.min<string>(1, 'Enter a value'))
const vcpusPipe = v.number().pipe(v.int(), v.gte(1))

export class VercelSecretCredentialsFormDraft extends FormDraft<VercelCredentialsModel, VercelCredentialsModel, VercelCredentialsFields> {
	protected readonly rules = {
		tokenSecretId: nestedFormDraftPipe<FormDraftSelect<string>>(),
		teamIdSecretId: nestedFormDraftPipe<FormDraftSelect<string>>(),
		projectIdSecretId: nestedFormDraftPipe<FormDraftSelect<string>>(),
	}

	constructor() {
		super({
			tokenSecretId: new FormDraftSelect<string>({ initialValue: '', pipe: secretIdPipe }),
			teamIdSecretId: new FormDraftSelect<string>({ initialValue: '', pipe: secretIdPipe }),
			projectIdSecretId: new FormDraftSelect<string>({ initialValue: '', pipe: secretIdPipe }),
		})
	}

	setOptions(secretIds: readonly string[]): void {
		this.tokenSecretId.setOptions(secretIds)
		this.teamIdSecretId.setOptions(secretIds)
		this.projectIdSecretId.setOptions(secretIds)
	}

	clearOptions(): void {
		this.tokenSecretId.clearOptions()
		this.teamIdSecretId.clearOptions()
		this.projectIdSecretId.clearOptions()
	}

	protected model = (): VercelCredentialsModel => ({
		tokenSecretId: this.tokenSecretId.toModel(),
		teamIdSecretId: this.teamIdSecretId.toModel(),
		projectIdSecretId: this.projectIdSecretId.toModel(),
	})

	protected load = (entity: VercelCredentialsModel): void => {
		this.tokenSecretId.loadEntity(entity.tokenSecretId)
		this.teamIdSecretId.loadEntity(entity.teamIdSecretId)
		this.projectIdSecretId.loadEntity(entity.projectIdSecretId)
	}
}

export class AgentRunSandboxResourcesFormDraft extends FormDraft<
	AgentRunSandboxConfig['resources'],
	AgentRunSandboxConfig['resources'],
	SandboxResourcesFields
> {
	protected readonly rules = { vcpus: vcpusPipe }

	constructor() {
		super({ vcpus: 2 })
	}

	protected model = (): AgentRunSandboxConfig['resources'] => ({ vcpus: this.vcpus })

	protected load = (entity: AgentRunSandboxConfig['resources']): void => {
		this.vcpus = entity.vcpus
	}
}

export class StringListItemDraft extends FormDraft<string, string, StringListItemFields> {
	protected readonly rules = { value: nonEmptyStringPipe }

	constructor() {
		super({ value: '' })
	}

	protected model = (): string => this.value.trim()

	protected load = (entity: string): void => {
		this.value = entity
	}
}

export class AgentRunSandboxNetworkPolicyFormDraft extends FormDraft<
	AgentRunSandboxNetworkPolicy,
	AgentRunSandboxNetworkPolicy,
	SandboxNetworkPolicyFields
> {
	protected override readonly onSet = {
		type: () => this.revalidate('hosts', 'allowSubnets', 'denySubnets'),
	}

	protected readonly rules = {
		type: networkPolicyTypePipe,
		hosts: v.conditional(v.array(nestedFormDraftPipe<StringListItemDraft>()), () => this.type === 'allow-list'),
		allowSubnets: v.conditional(v.array(nestedFormDraftPipe<StringListItemDraft>()), () => this.type === 'allow-list'),
		denySubnets: v.conditional(v.array(nestedFormDraftPipe<StringListItemDraft>()), () => this.type === 'allow-list'),
	}

	constructor() {
		super({
			type: 'allow-all',
			hosts: FormDraft.array(() => new StringListItemDraft()),
			allowSubnets: FormDraft.array(() => new StringListItemDraft()),
			denySubnets: FormDraft.array(() => new StringListItemDraft()),
		})
	}

	protected model = (): AgentRunSandboxNetworkPolicy => {
		switch (this.type) {
			case 'allow-all':
				return { type: 'allow-all' }
			case 'deny-all':
				return { type: 'deny-all' }
			case 'allow-list':
				return {
					type: 'allow-list',
					hosts: this.hosts.toModel(),
					subnets: { allow: this.allowSubnets.toModel(), deny: this.denySubnets.toModel() },
				}
			default:
				throw new Error(`Unexpected sandbox network policy type: ${String(this.type satisfies never)}`)
		}
	}

	protected load = (entity: AgentRunSandboxNetworkPolicy): void => {
		this.type = entity.type
		switch (entity.type) {
			case 'allow-all':
			case 'deny-all':
				this.hosts.loadEntity([])
				this.allowSubnets.loadEntity([])
				this.denySubnets.loadEntity([])
				return
			case 'allow-list':
				this.hosts.loadEntity(entity.hosts)
				this.allowSubnets.loadEntity(entity.subnets.allow)
				this.denySubnets.loadEntity(entity.subnets.deny)
				return
			default:
				throw new Error(`Unexpected sandbox network policy type: ${String(entity satisfies never)}`)
		}
	}
}

export class AgentRunSandboxSourceFormDraft extends FormDraft<
	AgentRunSandboxSourceConfig,
	AgentRunSandboxSourceConfig,
	SandboxSourceFields
> {
	protected override readonly onSet = {
		type: () => this.revalidate('ociImage', 'runtime', 'vcrImage', 'credentials'),
	}

	protected readonly rules = {
		type: sandboxSourceTypePipe,
		ociImage: v.conditional(nonEmptyStringPipe, () => this.type === 'consumer-managed'),
		runtime: v.conditional(vercelRuntimePipe, () => this.type === 'vercel-runtime'),
		vcrImage: v.conditional(nonEmptyStringPipe, () => this.type === 'vercel-vcr-image'),
		credentials: v.conditional(nestedFormDraftPipe<VercelSecretCredentialsFormDraft>(), () => this.type !== 'consumer-managed'),
	}

	constructor() {
		super({
			type: 'consumer-managed',
			ociImage: '',
			runtime: 'node24',
			vcrImage: '',
			credentials: new VercelSecretCredentialsFormDraft(),
		})
	}

	setSecretOptions(secretIds: readonly string[]): void {
		this.credentials.setOptions(secretIds)
	}

	clearSecretOptions(): void {
		this.credentials.clearOptions()
	}

	protected model = (): AgentRunSandboxSourceConfig => {
		switch (this.type) {
			case 'consumer-managed':
				return { type: 'consumer-managed', ociImage: this.ociImage.trim() }
			case 'vercel-runtime':
				return { type: 'vercel-runtime', runtime: this.runtime, credentials: this.credentials.toModel() }
			case 'vercel-vcr-image':
				return { type: 'vercel-vcr-image', vcrImage: this.vcrImage.trim(), credentials: this.credentials.toModel() }
			default:
				throw new Error(`Unexpected sandbox source type: ${String(this.type satisfies never)}`)
		}
	}

	protected load = (entity: AgentRunSandboxSourceConfig): void => {
		this.type = entity.type
		switch (entity.type) {
			case 'consumer-managed':
				this.ociImage = entity.ociImage
				return
			case 'vercel-runtime':
				this.runtime = entity.runtime
				this.credentials.loadEntity(entity.credentials)
				return
			case 'vercel-vcr-image':
				this.vcrImage = entity.vcrImage
				this.credentials.loadEntity(entity.credentials)
				return
			default:
				throw new Error(`Unexpected sandbox source type: ${String(entity satisfies never)}`)
		}
	}
}

export class AgentRunSandboxConfigFormDraft extends FormDraft<AgentRunSandboxConfig, AgentRunSandboxConfig, SandboxConfigFields> {
	protected readonly rules = {
		source: nestedFormDraftPipe<AgentRunSandboxSourceFormDraft>(),
		resources: nestedFormDraftPipe<AgentRunSandboxResourcesFormDraft>(),
		networkPolicy: nestedFormDraftPipe<AgentRunSandboxNetworkPolicyFormDraft>(),
	}

	constructor() {
		super({
			source: new AgentRunSandboxSourceFormDraft(),
			resources: new AgentRunSandboxResourcesFormDraft(),
			networkPolicy: new AgentRunSandboxNetworkPolicyFormDraft(),
		})
	}

	setSecretOptions(secretIds: readonly string[]): void {
		this.source.setSecretOptions(secretIds)
	}

	clearSecretOptions(): void {
		this.source.clearSecretOptions()
	}

	protected model = (): AgentRunSandboxConfig => ({
		source: this.source.toModel(),
		resources: this.resources.toModel(),
		networkPolicy: this.networkPolicy.toModel(),
	})

	protected load = (entity: AgentRunSandboxConfig): void => {
		this.source.loadEntity(entity.source)
		this.resources.loadEntity(entity.resources)
		this.networkPolicy.loadEntity(entity.networkPolicy)
	}
}

if (import.meta.vitest) {
	const { describe, expect, it } = import.meta.vitest

	describe('AgentRunSandboxConfigFormDraft', () => {
		it('defaults to consumer-managed with explicit vCPUs and allow-all network', () => {
			const draft = new AgentRunSandboxConfigFormDraft()
			draft.source.ociImage = 'alpine:latest'

			expect(draft.toModel()).toEqual({
				source: { type: 'consumer-managed', ociImage: 'alpine:latest' },
				resources: { vcpus: 2 },
				networkPolicy: { type: 'allow-all' },
			})
		})

		it('models Vercel credentials and allow-list list fields', () => {
			const draft = new AgentRunSandboxConfigFormDraft()
			draft.setSecretOptions(['secret-token', 'secret-team', 'secret-project'])
			draft.source.type = 'vercel-runtime'
			draft.source.runtime = 'node26'
			draft.source.credentials.tokenSecretId.value = 'secret-token'
			draft.source.credentials.teamIdSecretId.value = 'secret-team'
			draft.source.credentials.projectIdSecretId.value = 'secret-project'
			draft.networkPolicy.type = 'allow-list'
			draft.networkPolicy.hosts.add().value = 'registry.npmjs.org'
			draft.networkPolicy.allowSubnets.add().value = '10.0.0.0/8'
			draft.networkPolicy.denySubnets.add().value = '10.1.0.0/16'

			expect(draft.toModel()).toEqual({
				source: {
					type: 'vercel-runtime',
					runtime: 'node26',
					credentials: { tokenSecretId: 'secret-token', teamIdSecretId: 'secret-team', projectIdSecretId: 'secret-project' },
				},
				resources: { vcpus: 2 },
				networkPolicy: {
					type: 'allow-list',
					hosts: ['registry.npmjs.org'],
					subnets: { allow: ['10.0.0.0/8'], deny: ['10.1.0.0/16'] },
				},
			})
		})
	})
}
