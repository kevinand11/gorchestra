import type { RawSandbox, RawSandboxRunCommandInput, SandboxListDirectoryOutput, SandboxReadFileOutput } from '../services'

export function noopRawSandboxInstance(): RawSandbox {
	return {
		runCommand: () => Promise.resolve({ exitCode: 0, summary: 'Command succeeded.', stdout: null, stderr: null }),
		readFile: () => Promise.resolve(null),
		writeFile: () => Promise.resolve(),
		listDirectory: () => Promise.resolve(null),
		deletePath: () => Promise.resolve(),
		release: () => Promise.resolve({ summary: 'Sandbox released.' }),
	}
}

export function readTestSandboxFile(files: Map<string, string>, path: string): SandboxReadFileOutput {
	const contents = files.get(path)
	if (contents !== undefined) return { type: 'file', contentsBase64: Buffer.from(contents).toString('base64') }
	return hasTestSandboxDescendant(files, path) ? { type: 'directory' } : null
}

export function writeTestSandboxFile(files: Map<string, string>, path: string, contentsBase64: string): void {
	files.set(path, Buffer.from(contentsBase64, 'base64').toString('utf8'))
}

export function listTestSandboxDirectory(files: Map<string, string>, path: string): SandboxListDirectoryOutput {
	if (files.has(path)) return { type: 'file' }
	const entries = new Map<string, 'file' | 'directory'>()
	for (const filePath of files.keys()) {
		if (!filePath.startsWith(`${path}/`)) continue
		const relativePath = filePath.slice(path.length + 1)
		const [name, ...rest] = relativePath.split('/')
		if (name !== undefined && name.length > 0) entries.set(name, rest.length === 0 ? 'file' : 'directory')
	}
	return entries.size === 0 ? null : { type: 'directory', entries: [...entries].map(([name, type]) => ({ name, type })) }
}

export function deleteTestSandboxPath(files: Map<string, string>, path: string): void {
	for (const filePath of [...files.keys()]) {
		if (filePath === path || filePath.startsWith(`${path}/`)) files.delete(filePath)
	}
}

export function testRawSandbox(
	input: {
		files?: Map<string, string>
		commands?: RawSandboxRunCommandInput[] | unknown[]
		release?: () => Promise<{ summary: string }>
		writeFile?: RawSandbox['writeFile']
		runCommand?: RawSandbox['runCommand']
	} = {},
): RawSandbox {
	const files = input.files ?? new Map<string, string>()
	const commands = input.commands
	return {
		runCommand: (command) => {
			;(commands as unknown[] | undefined)?.push(command)
			return (
				input.runCommand?.(command) ?? Promise.resolve({ exitCode: 0, summary: 'Command completed.', stdout: null, stderr: null })
			)
		},
		readFile: (path) => Promise.resolve(readTestSandboxFile(files, path)),
		writeFile: input.writeFile ?? ((path, contentsBase64) => Promise.resolve(writeTestSandboxFile(files, path, contentsBase64))),
		listDirectory: (path) => Promise.resolve(listTestSandboxDirectory(files, path)),
		deletePath: (path) => Promise.resolve(deleteTestSandboxPath(files, path)),
		release: input.release ?? (() => Promise.resolve({ summary: 'released' })),
	}
}

function hasTestSandboxDescendant(files: Map<string, string>, path: string): boolean {
	for (const filePath of files.keys()) {
		if (filePath.startsWith(`${path}/`)) return true
	}
	return false
}
