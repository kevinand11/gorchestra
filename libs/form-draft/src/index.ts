import { FormDraftArray } from './array'
import { setFormDraftArrayFactory } from './form-draft'

setFormDraftArrayFactory((factory) => new FormDraftArray(factory))

export { FormDraftArray } from './array'
export { FormDraft, formDraftPipe } from './form-draft'
export { FormDraftMultiSelect, FormDraftSelect } from './select'
export type {
	FormDraftMultiSelectOptions,
	FormDraftMultiSelectPipeBuilder,
	FormDraftSelectOptions,
	FormDraftSelectPipeBuilder,
} from './select'
export type { FormDraftLike } from './types'
