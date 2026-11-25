import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { InputType } from './types.js'

/**
 * Writes resolved inputs as one JSON object to inputs.json in a new 0700
 * directory under runnerTemp, with file mode 0600, and returns the file path.
 * Consumers read the file (for example `ansible-playbook --extra-vars @file`),
 * so values never appear in step outputs, argv or environment variables.
 */
export async function writePrivateInputsFile(
  inputs: readonly { key: string; value: InputType }[],
  runnerTemp: string | undefined
): Promise<string> {
  if (!runnerTemp) {
    throw new Error('RUNNER_TEMP is required for output-mode private-file')
  }
  const values = new Map<string, InputType>()
  for (const { key, value } of inputs) {
    if (values.has(key)) throw new Error(`Duplicate input name: ${key}`)
    values.set(key, value)
  }
  // mkdtemp creates the directory with mode 0700.
  const directory = await mkdtemp(
    path.join(runnerTemp, 'resolved-stack-inputs-')
  )
  const file = path.join(directory, 'inputs.json')
  try {
    await writeFile(file, JSON.stringify(Object.fromEntries(values)), {
      mode: 0o600,
      flag: 'wx'
    })
  } catch (error) {
    await rm(directory, { recursive: true, force: true })
    throw error
  }
  return file
}
