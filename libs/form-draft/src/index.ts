import { FormDraftArray } from './array'
import { setFormDraftArrayFactory } from './form-draft'

setFormDraftArrayFactory((factory) => new FormDraftArray(factory))

export { FormDraftArray } from './array'
export { FormDraft, syncFormDraftFromEntity } from './form-draft'
export { nestedFormDraftPipe } from './nested'
export { FormDraftMultiSelect, FormDraftSelect } from './select'
export type { FormDraftMultiSelectOptions, FormDraftSelectOptions } from './select'
export type { FormDraftLike } from './types'
