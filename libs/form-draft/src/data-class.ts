type Accessor<Keys extends object> = {
	get: <Key extends keyof Keys>(key: Key, keys: Keys) => Keys[Key]
	set: <Key extends keyof Keys>(key: Key, value: Keys[Key], keys: Keys) => void
}

function wrapWithProperties(): { new <Keys extends object>(): Keys } {
	return class {} as unknown as { new <Keys extends object>(): Keys }
}

// @ts-expect-error Generic runtime property wrapper intentionally gives draft instances typed field access.
export class LocalDataClass<Keys extends object> extends wrapWithProperties()<Keys> {
	constructor(keys: Keys, access: Accessor<Keys>) {
		super()
		Object.keys(keys).forEach((key) => {
			const typedKey = key as keyof Keys
			Object.defineProperty(this, key, {
				get: () => access.get(typedKey, keys),
				set: (value: Keys[typeof typedKey]) => access.set(typedKey, value, keys),
				enumerable: true,
				configurable: true,
			})
		})
	}
}
