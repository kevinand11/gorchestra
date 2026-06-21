export type RefLike<T> = { value: T }

export type PageActionInput = {
	action: () => Promise<void>
	getErrorMessage: (error: unknown) => string
	setBusy: (busy: boolean) => void
	setErrorMessage: (message: string) => void
}

export type PageActionRunnerInput = {
	busy: RefLike<boolean>
	errorMessage: RefLike<string>
	getErrorMessage: (error: unknown) => string
}

export type PageActionRunner = (action: () => Promise<void>) => Promise<void>

export function createPageActionRunner(input: PageActionRunnerInput): PageActionRunner {
	return (action) =>
		runPageAction({
			action,
			getErrorMessage: input.getErrorMessage,
			setBusy: (value) => {
				input.busy.value = value
			},
			setErrorMessage: (value) => {
				input.errorMessage.value = value
			},
		})
}

async function runPageAction(input: PageActionInput): Promise<void> {
	input.setBusy(true)
	input.setErrorMessage('')
	try {
		await input.action()
	} catch (error) {
		input.setErrorMessage(input.getErrorMessage(error))
	} finally {
		input.setBusy(false)
	}
}
